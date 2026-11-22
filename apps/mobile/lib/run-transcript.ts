import type { AgentTask, TaskMessagePayload } from "@multica/core/types";
import { redactSecrets } from "@multica/core/security/redact-secrets";
import { failureReasonKey } from "./failure-reason-label";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const RUN_TRANSCRIPT_PATHNAME =
  "/[workspace]/issue/[id]/run/[taskId]" as const;

export function runTranscriptRoute(
  workspace: string,
  issueId: string,
  taskId: string,
) {
  return {
    pathname: RUN_TRANSCRIPT_PATHNAME,
    params: { workspace, id: issueId, taskId },
  } as const;
}

export function isRunTranscriptTaskId(taskId: unknown): taskId is string {
  return typeof taskId === "string" && UUID_PATTERN.test(taskId);
}

export function isCancellableRunStatus(status: AgentTask["status"]): boolean {
  return (
    status === "queued" ||
    status === "deferred" ||
    status === "dispatched" ||
    status === "waiting_local_directory" ||
    status === "running"
  );
}

const builtRuns = new WeakMap<
  TaskMessagePayload,
  { members: readonly TaskMessagePayload[]; message: TaskMessagePayload }
>();

function redactInput(value: unknown, key = ""): unknown {
  // JSON's quoted keys bypass the key=value rules in redactSecrets. Probe the
  // key separately so whitespace or non-string secret values cannot leak.
  const probe = `${key}=redaction-probe`;
  if (key && redactSecrets(probe) !== probe) return "[REDACTED]";
  if (typeof value === "string") {
    return redactSecrets(value);
  }
  if (Array.isArray(value)) return value.map((item) => redactInput(item, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactInput(item, name)]));
  }
  return value;
}

function buildRun(members: TaskMessagePayload[]): TaskMessagePayload {
  const first = members[0]!;
  const cached = builtRuns.get(first);
  if (cached?.members.length === members.length &&
      cached.members.every((member, index) => member === members[index])) return cached.message;
  const merged = { ...first };
  if (members.length > 1) {
    merged.content = members.map((member) => member.content ?? "").join("");
    merged.created_at = members.findLast((member) => member.created_at)?.created_at;
  }
  const message = {
    ...merged,
    tool: merged.tool ? redactSecrets(merged.tool) : merged.tool,
    content: merged.content ? redactSecrets(merged.content) : merged.content,
    output: merged.output ? redactSecrets(merged.output) : merged.output,
    input: merged.input ? redactInput(merged.input) as Record<string, unknown> : merged.input,
  };
  builtRuns.set(first, { members, message });
  return message;
}

/** Coalesce before redacting: credentials can span daemon flushes. */
export function buildRunTranscript(
  messages: readonly TaskMessagePayload[],
): TaskMessagePayload[] {
  const items: TaskMessagePayload[] = [];
  const seen = new Set<string>();
  let members: TaskMessagePayload[] = [];
  for (const message of [...messages].sort((a, b) => a.seq - b.seq)) {
    const identity = `${message.task_id}:${message.seq}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const previous = members[members.length - 1];
    if (
      previous &&
      previous.task_id === message.task_id &&
      (message.type === "text" || message.type === "thinking") &&
      previous.type === message.type
    ) {
      members.push(message);
    } else {
      if (members.length) items.push(buildRun(members));
      members = [message];
    }
  }
  if (members.length) items.push(buildRun(members));
  return items;
}

export type RunTranscriptEntry =
  | { kind: "message"; task_id: string; seq: number; message: TaskMessagePayload }
  | { kind: "tool"; task_id: string; seq: number; call?: TaskMessagePayload; result?: TaskMessagePayload };

/** Pair by opaque identity, never by completion order or a shared tool name. */
export function buildRunTranscriptEntries(messages: readonly TaskMessagePayload[]): RunTranscriptEntry[] {
  const entries: RunTranscriptEntry[] = [];
  const pending = new Map<string, Extract<RunTranscriptEntry, { kind: "tool" }>>();

  for (const message of buildRunTranscript(messages)) {
    // Missing IDs stay unpaired rather than guessing which parallel call won.
    const key = message.call_id ? `${message.task_id}:${message.call_id}` : null;
    if (message.type === "tool_use") {
      const entry = { kind: "tool" as const, task_id: message.task_id, seq: message.seq, call: message };
      entries.push(entry);
      if (key) pending.set(key, entry);
    } else if (message.type === "tool_result") {
      const call = key ? pending.get(key) : undefined;
      if (call && key) {
        call.result = message;
        pending.delete(key);
      } else {
        entries.push({ kind: "tool", task_id: message.task_id, seq: message.seq, result: message });
      }
    } else {
      entries.push({ kind: "message", task_id: message.task_id, seq: message.seq, message });
    }
  }
  return entries;
}

export function runToolContext(call: TaskMessagePayload | undefined): string | undefined {
  const input = call?.input ? redactInput(call.input) as Record<string, unknown> : undefined;
  if (!input) return undefined;
  const context = [
    input.command, input.cmd, input.file_path, input.path, input.pattern,
    input.query, input.description, input.prompt, input.skill, ...Object.values(input),
  ].find((value): value is string => typeof value === "string" && value.trim().length > 0);
  return context;
}

export function runEntrySummary(entry: RunTranscriptEntry): string {
  const text = entry.kind === "tool"
    ? runToolContext(entry.call) || entry.call?.tool || entry.result?.tool || ""
    : entry.message.content || "";
  // Redact the entire value before clipping, including the accessibility label.
  return redactSecrets(text).replace(/\s+/g, " ").trim().slice(0, 240);
}

/** An unfinished call stays current even when a parallel call returns later. */
export function currentRunEntry(entries: readonly RunTranscriptEntry[]): RunTranscriptEntry | undefined {
  return entries.findLast((entry) => entry.kind === "tool" && !entry.result)
    ?? entries.findLast((entry) => entry.kind === "tool" || entry.message.content?.trim());
}

export function runToolStatus(
  entry: Extract<RunTranscriptEntry, { kind: "tool" }>,
  status: AgentTask["status"],
): "completed" | "running" | "failed" | "cancelled" | "unavailable" {
  if (entry.result) return "completed";
  if (isCancellableRunStatus(status)) return "running";
  if (status === "failed" || status === "cancelled") return status;
  // A successful run is not evidence that an unrecorded result succeeded.
  return "unavailable";
}

export function getRunDiagnostics(
  task: Pick<AgentTask, "status" | "failure_reason" | "error">,
) {
  const reasonKey = task.status === "failed" ? failureReasonKey(task.failure_reason) : null;
  const error = task.error?.trim() ? redactSecrets(task.error) : null;
  return reasonKey || error ? { reasonKey, error } : null;
}
