// @vitest-environment node
import type { ReactElement } from "react";
import type { TaskMessagePayload } from "@multica/core/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { AgentTaskSchema } from "@/data/schemas";
import { useRunTranscriptRealtime } from "@/data/realtime/use-run-transcript-realtime";
import { embeddedHeaderCases } from "@/lib/__tests__/embedded-header-cases";
import { RunActivity } from "./run-activity";

const state = vi.hoisted(() => ({
  expanded: false,
  query: { data: [] as TaskMessagePayload[], isPending: false, isFetching: false, isError: false, refetch: vi.fn() },
}));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  memo: (component: unknown) => component,
  useMemo: (create: () => unknown) => create(),
  useState: () => [state.expanded, (open: boolean) => { state.expanded = open; }],
}));
vi.mock("react-native", () => ({ View: "View", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator" }));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...await importOriginal<typeof import("@tanstack/react-query")>(),
  useQuery: vi.fn(() => state.query),
}));
vi.mock("@/data/api", () => ({ api: {} }));
vi.mock("@/components/ui/text", () => ({ Text: "Text" }));
vi.mock("@/components/ui/actor-avatar", () => ({ ActorAvatar: "ActorAvatar" }));
vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: "Collapsible", CollapsibleContent: "CollapsibleContent", CollapsibleTrigger: "CollapsibleTrigger",
}));
vi.mock("./run-transcript", () => ({ TranscriptEntry: "TranscriptEntry" }));
vi.mock("@/data/realtime/use-run-transcript-realtime", () => ({ useRunTranscriptRealtime: vi.fn() }));
vi.mock("@/data/workspace-store", () => ({
  useWorkspaceStore: (select: (value: unknown) => unknown) => select({ currentWorkspaceSlug: "acme" }),
}));
vi.mock("@/data/use-actor-name", () => ({ useActorLookup: () => ({ getName: () => "Builder" }) }));
vi.mock("@/lib/i18n", () => ({ useT: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/use-color-scheme", () => ({ useColorScheme: () => ({ colorScheme: "dark" }) }));
vi.mock("@/lib/theme", () => ({ THEME: { dark: { mutedForeground: "#aaa" } } }));

type Element = ReactElement<Record<string, unknown>>;
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function content(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(content).join(" ");
  if (node && typeof node === "object" && "props" in node) return content((node as Element).props.children);
  return "";
}
const task = AgentTaskSchema.parse({
  id: "123e4567-e89b-12d3-a456-426614174000", issue_id: "issue-1", agent_id: "agent-1", status: "running",
});
function open(status = task.status) {
  const tree = RunActivity({ task: { ...task, status } });
  return { tree: tree as Element, nodes: elements(tree) };
}

describe("live execution card wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.expanded = false;
    Object.assign(state.query, { data: [], isPending: false, isFetching: false, isError: false });
  });

  it("loads the running record while collapsed and scopes its subscription to this run", () => {
    const { tree } = open();
    expect(useQuery).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, staleTime: 0 }));
    expect(useRunTranscriptRealtime).toHaveBeenCalledWith(task.issue_id, task.id);
    tree.props.onOpenChange && (tree.props.onOpenChange as (open: boolean) => void)(true);
    expect(open().tree.props.open).toBe(true);
  });

  it.each(["queued", "deferred", "dispatched", "waiting_local_directory"] as const)(
    "keeps %s distinct and fetches its record only after expansion", (status) => {
      const { nodes } = open(status);
      expect(content(nodes.find((node) => node.type === "CollapsibleTrigger"))).toContain(`runs.status.${status}`);
      expect(useQuery).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
      state.expanded = true;
      open(status);
      expect(useQuery).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }));
    },
  );

  it("shows the current command and bounds the inline list to six recent steps", () => {
    state.query.data = Array.from({ length: 12 }, (_, index) => ({
      task_id: task.id, issue_id: task.issue_id, seq: index + 1, type: "tool_use",
      call_id: `call-${index}`, tool: "exec_command", input: { cmd: `pnpm test ${index}` },
    }));
    const { nodes } = open();
    expect(content(nodes.find((node) => node.type === "CollapsibleTrigger"))).toContain("pnpm test 11");
    const steps = nodes.filter((node) => node.type === "TranscriptEntry");
    expect(steps).toHaveLength(6);
    expect(steps[0].props.item).toMatchObject({ seq: 7 });
    expect(steps.at(-1)?.props.status).toBe("running");
    const fullLog = nodes.find((node) => node.type === "Pressable")!;
    (fullLog.props.onPress as () => void)();
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/[workspace]/issue/[id]/run/[taskId]",
      params: { workspace: "acme", id: task.issue_id, taskId: task.id },
    });
  });

  it("uses sanitized commands for the preview and passes sanitized parameters to expanded steps", () => {
    state.query.data = [{
      task_id: task.id, issue_id: task.issue_id, seq: 1, type: "tool_use",
      call_id: "request", tool: "exec_command",
      input: {
        command: `curl -H "Authorization: Basic opaque-basic" https://example.test`,
        env: { AWS_SESSION_TOKEN: "opaque-session", token_count: 12 },
      },
    }];
    const original = structuredClone(state.query.data);
    const { nodes } = open();
    const safeCommand = `curl -H "Authorization: [REDACTED]" https://example.test`;
    expect(content(nodes.find((node) => node.type === "CollapsibleTrigger"))).toContain(safeCommand);
    expect(nodes.find((node) => node.type === "TranscriptEntry")?.props.item).toMatchObject({
      call: { input: {
        command: safeCommand,
        env: { AWS_SESSION_TOKEN: "[REDACTED]", token_count: 12 },
      } },
    });
    expect(state.query.data).toEqual(original);
  });

  describe.each(["cmd", "command"])("embedded commands in the collapsed %s preview", (field) => {
    it.each(embeddedHeaderCases)("displays a safe preview for $name", ({ command, safe }) => {
      state.query.data = [{
        task_id: task.id, issue_id: task.issue_id, seq: 1, type: "tool_use",
        call_id: "request", tool: "exec_command", input: { [field]: command },
      }];
      const { nodes } = open();
      const preview = content(nodes.find((node) => node.type === "CollapsibleTrigger"));
      expect(preview).toContain(safe);
      expect(preview).not.toContain("opaque-");
      expect(nodes.find((node) => node.type === "TranscriptEntry")?.props.item)
        .toMatchObject({ call: { input: { [field]: safe } } });
      expect(state.query.data[0].input).toEqual({ [field]: command });
    });
  });

  it("offers a retry after a failed load while retaining streamed steps", () => {
    state.query.isError = true;
    const { nodes } = open();
    const retry = nodes.find((node) => node.type === "Pressable")!;
    expect(content(retry)).toContain("runs.transcript.retry");
    (retry.props.onPress as () => void)();
    expect(state.query.refetch).toHaveBeenCalledOnce();
  });
});
