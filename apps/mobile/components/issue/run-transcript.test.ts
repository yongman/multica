// @vitest-environment node
import { createElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { AgentTaskSchema } from "@/data/schemas";
import type { TaskMessagePayload } from "@multica/core/types";
import { RunTranscript } from "./run-transcript";

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useMemo: (create: () => unknown) => create(),
  useState: (initial: unknown) => [initial, vi.fn()],
}));
vi.mock("react-native", () => ({ FlatList: "FlatList", View: "View", Pressable: "Pressable" }));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
vi.mock("nativewind", () => ({ useColorScheme: () => ({ colorScheme: "light" }) }));
vi.mock("@/components/ui/text", () => ({ Text: "Text" }));
vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: "Collapsible", CollapsibleContent: "CollapsibleContent", CollapsibleTrigger: "CollapsibleTrigger",
}));
vi.mock("@/lib/markdown", () => ({ Markdown: "Markdown" }));
vi.mock("@/lib/i18n", () => ({ useT: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/theme", () => ({ THEME: { light: { mutedForeground: "#555" } } }));

type Element = ReactElement<Record<string, unknown>>;
// Evaluate the real transcript components down to mocked native Text props,
// including JSON formatting and clipping. This does not test native rendering.
function renderedElements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(renderedElements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  if (typeof element.type === "function") {
    const component = element.type as (props: Record<string, unknown>) => unknown;
    return renderedElements(component(element.props));
  }
  if (element.type === "FlatList") {
    const renderItem = element.props.renderItem as (args: { item: unknown }) => unknown;
    return [
      ...renderedElements(element.props.ListHeaderComponent),
      ...(element.props.data as unknown[]).flatMap((item) => renderedElements(renderItem({ item }))),
    ];
  }
  return [element, ...renderedElements(element.props.children)];
}

const task = AgentTaskSchema.parse({ id: "task-1", issue_id: "issue-1", status: "running" });

describe("transcript input display", () => {
  it.each(["cmd", "command"])("renders valid sanitized JSON for %s without corrupting headers or trailing arguments", (field) => {
    const rawCommand = `curl -H "Authorization: Digest user=\\"user\\",\\\n response=\\"opaque-response\\"" -H X-Auth-Token:\\ opaque-token -H "Accept: application/json" --verbose`;
    const safeCommand = `curl -H "Authorization: [REDACTED]" -H X-Auth-Token:[REDACTED] -H "Accept: application/json" --verbose`;
    const input = {
      [field]: rawCommand,
      headers: { "X-Auth-Token": "opaque-header-token", Accept: "application/json" },
      env: { AWS_SESSION_TOKEN: "opaque-session", token_count: 12 },
    };
    const items: TaskMessagePayload[] = [{
      task_id: task.id, issue_id: task.issue_id, seq: 1, type: "tool_use",
      call_id: "request", tool: "exec_command", input,
    }];
    const original = structuredClone(items);
    const nodes = renderedElements(RunTranscript({ items, task, header: createElement("View") }));
    const displayed = nodes.find((node) => node.type === "Text" && node.props.selectable)?.props.children;
    const expected = {
      [field]: safeCommand,
      headers: { "X-Auth-Token": "[REDACTED]", Accept: "application/json" },
      env: { AWS_SESSION_TOKEN: "[REDACTED]", token_count: 12 },
    };
    expect(displayed).toBe(JSON.stringify(expected, null, 2));
    expect(JSON.parse(displayed as string)).toEqual(expected);
    expect(displayed).not.toMatch(/opaque-/);
    expect(items).toEqual(original);
  });

  it.each(["cmd", "command"])("hides split header names in the final %s JSON while preserving non-sensitive source text", (field) => {
    const command = `curl -H 'Authorization'': Basic opaque-basic' --header="X-API-""Key: opaque-api" -HCookie\\\n:\\ session=opaque-cookie -H "Ac""cept: application/json" --verbose`;
    const safeCommand = `curl -H 'Authorization: [REDACTED]' --header="X-API-Key: [REDACTED]" -HCookie:[REDACTED] -H "Ac""cept: application/json" --verbose`;
    const items: TaskMessagePayload[] = [{
      task_id: task.id, issue_id: task.issue_id, seq: 1, type: "tool_use",
      call_id: "request", tool: "exec_command", input: { [field]: command },
    }];
    const nodes = renderedElements(RunTranscript({ items, task, header: createElement("View") }));
    const displayed = nodes.find((node) => node.type === "Text" && node.props.selectable)?.props.children;
    expect(displayed).toBe(JSON.stringify({ [field]: safeCommand }, null, 2));
    expect(JSON.parse(displayed as string)).toEqual({ [field]: safeCommand });
    expect(displayed).not.toContain("opaque-");
    expect(items[0].input).toEqual({ [field]: command });
  });
});
