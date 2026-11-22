// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { TaskMessagePayload } from "@multica/core/types";
import { AgentTaskSchema } from "@/data/schemas";
import {
  buildRunTranscript,
  buildRunTranscriptEntries,
  currentRunEntry,
  getRunDiagnostics,
  isCancellableRunStatus,
  isRunTranscriptTaskId,
  RUN_TRANSCRIPT_PATHNAME,
  runTranscriptRoute,
  runEntrySummary,
  runToolContext,
  runToolStatus,
} from "./run-transcript";

describe("run transcript route", () => {
  it("keeps the issue and task identifiers in the route", () => {
    expect(runTranscriptRoute("acme", "issue-7", "task-9")).toEqual({
      pathname: "/[workspace]/issue/[id]/run/[taskId]",
      params: {
        workspace: "acme",
        id: "issue-7",
        taskId: "task-9",
      },
    });
    expect(RUN_TRANSCRIPT_PATHNAME).toContain("[taskId]");
  });

  it("accepts only backend task UUIDs for transcript requests", () => {
    expect(
      isRunTranscriptTaskId("123e4567-e89b-12d3-a456-426614174000"),
    ).toBe(true);
    expect(isRunTranscriptTaskId("optimistic-task")).toBe(false);
    expect(isRunTranscriptTaskId(undefined)).toBe(false);
  });
});

function message(seq: number, type: TaskMessagePayload["type"], content?: string): TaskMessagePayload {
  return { task_id: "task-1", issue_id: "issue-1", seq, type, content };
}

describe("historical run transcript", () => {
  it("pairs parallel same-name calls by ID when results finish in reverse order", () => {
    const callA = { ...message(1, "tool_use"), tool: "Bash", call_id: "A", input: { command: "test A" } };
    const callB = { ...message(2, "tool_use"), tool: "Bash", call_id: "B", input: { command: "test B" } };
    const resultB = { ...message(3, "tool_result"), tool: "Bash", call_id: "B", output: "B failed" };
    const resultA = { ...message(4, "tool_result"), tool: "Bash", call_id: "A", output: "A passed" };
    const source = [callA, callB, resultB, resultA];
    const original = structuredClone(source);

    expect(buildRunTranscriptEntries(source)).toEqual([
      { kind: "tool", task_id: "task-1", seq: 1, call: callA, result: resultA },
      { kind: "tool", task_id: "task-1", seq: 2, call: callB, result: resultB },
    ]);
    expect(source).toEqual(original);
    expect(runToolContext(callA)).toBe("test A");
    expect(runToolContext(callB)).toBe("test B");
  });

  it("keeps unmatched and unidentified tool output without guessing a call", () => {
    const call = { ...message(1, "tool_use"), tool: "Read", call_id: "known" };
    const orphan = { ...message(2, "tool_result"), tool: "Read", call_id: "missing", output: "orphan" };
    const noId = { ...message(3, "tool_result"), tool: "Read", output: "legacy" };
    expect(buildRunTranscriptEntries([call, orphan, noId, message(4, "text", "done")])).toEqual([
      { kind: "tool", task_id: "task-1", seq: 1, call },
      { kind: "tool", task_id: "task-1", seq: 2, result: orphan },
      { kind: "tool", task_id: "task-1", seq: 3, result: noId },
      { kind: "message", task_id: "task-1", seq: 4, message: message(4, "text", "done") },
    ]);
  });

  it("does not pair identical call IDs from different tasks", () => {
    const call = { ...message(1, "tool_use"), call_id: "shared" };
    const result = { ...message(2, "tool_result"), task_id: "another-task", call_id: "shared" };
    expect(buildRunTranscriptEntries([call, result])).toHaveLength(2);
  });

  it("redacts tool context and retains file paths in the collapsed heading", () => {
    expect(runToolContext({ ...message(1, "tool_use"), input: { file_path: "src/main.ts" } })).toBe("src/main.ts");
    expect(runToolContext({ ...message(1, "tool_use"), input: { command: "echo Authorization: Bearer fake-value" } }))
      .toBe("echo Authorization: Bearer [REDACTED]");
    expect(runToolContext(undefined)).toBeUndefined();
  });

  it("summarizes Codex commands, searches and native tool arguments", () => {
    for (const input of [{ cmd: "pnpm test" }, { query: "streaming" }, { file_path: "src/main.ts" }]) {
      expect(runToolContext({ ...message(1, "tool_use"), input })).toBe(Object.values(input)[0]);
    }
  });

  it("redacts nested credential headers and opaque credentials without hiding ordinary keys", () => {
    const input = {
      apiKey: "opaque-key",
      credentials: { username: "user", password: "opaque-password" },
      request: [{
        headers: {
          Authorization: "Basic dXNlcjpwYXNz",
          "pRoXy-AuThOrIzAtIoN": "Basic cHJveHk6cGFzcw==",
          Cookie: "session=opaque-cookie",
          "Set-Cookie": ["session=opaque-set-cookie"],
          "X-API-Key": "opaque-header-key",
          "Content-Type": "application/json",
        },
      }],
      token_count: 256,
      file_key: "docs/readme",
      secret_name: "deployment-secret",
    };
    const original = structuredClone(input);
    const sanitized = buildRunTranscript([{ ...message(1, "tool_use"), input }])[0].input;
    expect(sanitized).toEqual({
      apiKey: "[REDACTED]",
      credentials: "[REDACTED]",
      request: [{
        headers: {
          Authorization: "[REDACTED]",
          "pRoXy-AuThOrIzAtIoN": "[REDACTED]",
          Cookie: "[REDACTED]",
          "Set-Cookie": "[REDACTED]",
          "X-API-Key": "[REDACTED]",
          "Content-Type": "application/json",
        },
      }],
      token_count: 256,
      file_key: "docs/readme",
      secret_name: "deployment-secret",
    });
    expect(input).toEqual(original);
  });

  it.each(["apiKey", "Authorization", "Cookie", "access_token", "unrecognized_parameter"])(
    "never chooses %s as an arbitrary collapsed summary", (name) => {
      const call = { ...message(1, "tool_use"), tool: "http_request", input: { [name]: "opaque-credential" } };
      expect(runToolContext(call)).toBeUndefined();
      expect(runEntrySummary(buildRunTranscriptEntries([call])[0])).toBe("http_request");
      expect(runToolContext({ ...call, input: { ...call.input, description: "Inspect response" } }))
        .toBe("Inspect response");
    },
  );

  it("redacts header tuples and named entries while preserving non-credential headers", () => {
    const input = {
      headers: [
        ["Authorization", "Basic dXNlcjpwYXNz"],
        ["X-API-Key", "opaque-api-key"],
        ["Content-Type", "application/json"],
        { name: "Cookie", value: "session=opaque-cookie" },
        { name: "Accept", value: "application/json" },
      ],
    };
    expect(buildRunTranscript([{ ...message(1, "tool_use"), input }])[0].input).toEqual({
      headers: [
        ["Authorization", "[REDACTED]"],
        ["X-API-Key", "[REDACTED]"],
        ["Content-Type", "application/json"],
        { name: "Cookie", value: "[REDACTED]" },
        { name: "Accept", value: "application/json" },
      ],
    });
  });

  it("pairs sequential legacy calls with results and advances to later text", () => {
    const entries = buildRunTranscriptEntries([
      { ...message(1, "tool_use"), tool: "Bash", input: { command: "old command" } },
      { ...message(2, "tool_result"), tool: "Bash", output: "done" },
      message(3, "text", "Now checking the next change"),
      { ...message(4, "tool_use"), tool: "Bash", input: { command: "next command" } },
      { ...message(5, "tool_result"), tool: "Bash", output: "done again" },
      message(6, "text", "Ready for review"),
    ]);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({ kind: "tool", seq: 1, result: { seq: 2 } });
    expect(entries[2]).toMatchObject({ kind: "tool", seq: 4, result: { seq: 5 } });
    expect(runEntrySummary(currentRunEntry(entries)!)).toBe("Ready for review");
  });

  it("keeps ambiguous legacy calls independent and never promotes them over newer activity", () => {
    const entries = buildRunTranscriptEntries([
      { ...message(1, "tool_use"), tool: "Bash", input: { command: "parallel a" } },
      { ...message(2, "tool_use"), tool: "Bash", input: { command: "parallel b" } },
      { ...message(3, "tool_result"), tool: "Bash", output: "one result" },
      { ...message(4, "tool_result"), tool: "Bash", output: "other result" },
      { ...message(5, "tool_use"), tool: "Bash", input: { command: "later command" } },
      { ...message(6, "tool_result"), tool: "Bash", output: "later result" },
      message(7, "thinking", "Planning the next step"),
    ]);
    expect(entries).toHaveLength(6);
    for (const entry of entries.slice(0, 2)) {
      if (entry.kind !== "tool") throw new Error("expected tool");
      expect(entry.result).toBeUndefined();
      expect(runToolStatus(entry, "running")).toBe("unavailable");
    }
    expect(entries[4]).toMatchObject({ kind: "tool", seq: 5, result: { seq: 6 } });
    expect(runEntrySummary(currentRunEntry(entries)!)).toBe("Planning the next step");
  });

  it("does not mix identified calls, unnamed tools, or legacy calls from different runs", () => {
    const entries = buildRunTranscriptEntries([
      { ...message(1, "tool_use"), tool: "Read", call_id: "known" },
      { ...message(2, "tool_result"), tool: "Read" },
      message(3, "tool_use"),
      message(4, "tool_result"),
      { ...message(5, "tool_use"), tool: "Bash" },
      { ...message(6, "tool_result"), task_id: "task-2", tool: "Bash" },
    ]);
    expect(entries).toHaveLength(6);
    expect(entries.slice(0, 5).filter((entry) => entry.kind === "tool" && entry.result && entry.call)).toHaveLength(0);
    expect(currentRunEntry(entries)?.seq).toBe(1);
  });

  it("shows an unmatched legacy call as unknown while allowing newer prose to become current", () => {
    const entries = buildRunTranscriptEntries([
      { ...message(1, "tool_use"), tool: "Bash", input: { command: "old command" } },
      message(2, "text", "Working on something newer"),
    ]);
    const call = entries[0];
    if (call.kind !== "tool") throw new Error("expected tool");
    expect(runToolStatus(call, "running")).toBe("unavailable");
    expect(currentRunEntry(entries)?.seq).toBe(2);
  });

  it("deduplicates repeated frames and never joins prose from different runs", () => {
    const first = message(1, "text", "first");
    expect(buildRunTranscript([first, first, { ...message(2, "text", "second"), task_id: "task-2" }])
      .map((item) => item.content)).toEqual(["first", "second"]);
  });

  it("redacts nested input values without changing the raw evidence", () => {
    const input = { password: "secret value with spaces", nested: [{ API_KEY: 12345 }], cmd: "echo Bearer private" };
    const original = structuredClone(input);
    const items = buildRunTranscript([{
      ...message(1, "tool_use"), input,
    }]);
    expect(items[0].input).toEqual({
      password: "[REDACTED]", nested: [{ API_KEY: "[REDACTED]" }], cmd: "echo Bearer [REDACTED]",
    });
    expect(input).toEqual(original);
  });

  it("reuses unchanged redacted bodies but rebuilds coalesced streaming tails", () => {
    const tool = { ...message(1, "tool_result"), output: "large output" };
    const text = message(2, "text", "Bearer ");
    const before = buildRunTranscript([tool, text]);
    const after = buildRunTranscript([tool, text, message(3, "text", "private-token")]);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[1].content).toBe("Bearer [REDACTED]");
  });

  it("keeps a parallel pending command current, then retains the latest result", () => {
    const entries = buildRunTranscriptEntries([
      { ...message(1, "tool_use"), call_id: "a", input: { cmd: "test a" } },
      { ...message(2, "tool_use"), call_id: "b", input: { cmd: "test b" } },
      { ...message(3, "tool_result"), call_id: "b", output: "done" },
    ]);
    expect(currentRunEntry(entries)?.seq).toBe(1);
    expect(runEntrySummary(currentRunEntry(entries)!)).toBe("test a");
    expect(currentRunEntry([entries[1]])?.seq).toBe(2);
  });

  it("redacts the complete command before clipping the activity summary", () => {
    const entry = buildRunTranscriptEntries([{
      ...message(1, "tool_use"),
      input: { cmd: `${"x".repeat(220)} Authorization: Bearer private-token-with-long-tail` },
    }])[0];
    expect(runEntrySummary(entry)).not.toContain("private");
    expect(runEntrySummary(entry).length).toBeLessThanOrEqual(240);
  });

  it.each([
    ["queued", "running"], ["dispatched", "running"], ["running", "running"],
    ["deferred", "running"], ["waiting_local_directory", "running"],
    ["completed", "unavailable"], ["failed", "failed"], ["cancelled", "cancelled"],
  ] as const)("shows an unfinished tool honestly when its run is %s", (status, expected) => {
    const entry = buildRunTranscriptEntries([{ ...message(1, "tool_use"), call_id: "pending" }])[0];
    if (entry.kind !== "tool") throw new Error("expected tool");
    expect(runToolStatus(entry, status)).toBe(expected);
    expect(runToolStatus({ ...entry, result: message(2, "tool_result") }, status)).toBe("completed");
  });

  it("sorts and joins streamed Markdown without changing the source messages", () => {
    const messages = [
      message(3, "text", "\n```"),
      message(1, "text", "```ts\n"),
      message(2, "text", "const answer = 42;"),
    ];
    const original = structuredClone(messages);

    expect(buildRunTranscript(messages)).toEqual([
      expect.objectContaining({ seq: 1, content: "```ts\nconst answer = 42;\n```" }),
    ]);
    expect(messages).toEqual(original);
  });

  it("merges adjacent thinking but keeps tool calls, results, and errors in order", () => {
    const messages = [
      message(1, "thinking", "First "),
      { ...message(2, "thinking", "check"), created_at: "2026-10-28T00:00:02Z" },
      { ...message(3, "tool_use"), tool: "Read", input: { file_path: "README.md" }, call_id: "read-1" },
      { ...message(4, "tool_result"), output: "contents", output_truncated: true, call_id: "read-1" },
      message(5, "thinking", "Then"),
      message(6, "error", "Failed"),
      message(7, "text", "Result"),
    ];

    expect(buildRunTranscript(messages)).toEqual([
      { ...messages[0], content: "First check", created_at: messages[1].created_at },
      ...messages.slice(2),
    ]);
    expect(buildRunTranscript([])).toEqual([]);
  });

  it("redacts secrets after joining fragments, including tool output", () => {
    const token = ["ghp_", "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn"].join("");
    const result = buildRunTranscript([
      message(1, "text", token.slice(0, 12)),
      message(2, "text", token.slice(12)),
      { ...message(3, "tool_result"), output: `found ${token}` },
    ]);

    expect(result[0].content).toBe("[REDACTED GITHUB TOKEN]");
    expect(result[1].output).toBe("found [REDACTED GITHUB TOKEN]");
  });

  it("preserves startup diagnostics even when no execution messages exist", () => {
    const task = AgentTaskSchema.parse({
      id: "task-1", status: "failed", failure_reason: "environment_prepare_failed",
      error: "prepare execution environment: permission denied",
    });

    expect(buildRunTranscript([])).toEqual([]);
    expect(getRunDiagnostics(task)).toEqual({
      reasonKey: "failure_reason.environment_prepare_failed",
      error: "prepare execution environment: permission denied",
    });
  });

  it("redacts raw diagnostics and safely labels unknown failure reasons", () => {
    expect(getRunDiagnostics(AgentTaskSchema.parse({
      id: "task-1", status: "failed", failure_reason: "future_reason",
      error: "Authorization: Bearer fake-value",
    }))).toEqual({ reasonKey: "failure_reason.default", error: "Authorization: Bearer [REDACTED]" });
    expect(getRunDiagnostics(AgentTaskSchema.parse({ id: "task-1", status: "completed" }))).toBeNull();
  });
});

describe("run cancellation after schema parsing", () => {
  it.each(["queued", "deferred", "dispatched", "waiting_local_directory", "running"])(
    "keeps %s cancellable", (status) => {
      expect(isCancellableRunStatus(AgentTaskSchema.parse({ id: "task-1", status }).status)).toBe(true);
    },
  );
  it.each(["completed", "failed", "cancelled"])("does not cancel %s runs", (status) => {
    expect(isCancellableRunStatus(AgentTaskSchema.parse({ id: "task-1", status }).status)).toBe(false);
  });
});
