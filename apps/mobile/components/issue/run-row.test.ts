// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "expo-router";
import { AgentTaskSchema } from "@/data/schemas";
import { RunRow } from "./run-row";

vi.mock("react-native", () => ({ Pressable: "Pressable", View: "View" }));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
vi.mock("nativewind", () => ({ useColorScheme: () => ({ colorScheme: "light" }) }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("@/components/ui/text", () => ({ Text: "Text" }));
vi.mock("@/components/ui/actor-avatar", () => ({ ActorAvatar: "ActorAvatar" }));
vi.mock("./run-cancel-button", () => ({ RunCancelButton: "RunCancelButton" }));
vi.mock("./run-activity", () => ({ RunActivity: "RunActivity" }));
vi.mock("@/data/use-actor-name", () => ({ useActorLookup: () => ({ getName: () => "Builder" }) }));
vi.mock("@/data/workspace-store", () => ({
  useWorkspaceStore: (select: (value: unknown) => unknown) => select({ currentWorkspaceSlug: "acme" }),
}));
vi.mock("@/lib/i18n", () => ({ useT: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/theme", () => ({ THEME: { light: { mutedForeground: "#555" } } }));

describe("run row navigation and cancellation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens an active run while keeping cancellation outside the navigation target", () => {
    const task = AgentTaskSchema.parse({ id: "task-1", issue_id: "issue-1", status: "running" });
    const tree = RunRow({ task, issueId: task.issue_id });
    const [header, activity] = tree.props.children;
    const [link, cancel] = header.props.children;
    expect(link.type).toBe("Pressable");
    expect(cancel.type).toBe("RunCancelButton");
    expect(cancel.props).toMatchObject({ taskId: task.id, issueId: task.issue_id });
    expect(activity.type).toBe("RunActivity");
    link.props.onPress();
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/[workspace]/issue/[id]/run/[taskId]",
      params: { workspace: "acme", id: task.issue_id, taskId: task.id },
    });
  });

  it("preserves historical navigation without mounting a live card or cancel button", () => {
    const task = AgentTaskSchema.parse({ id: "task-2", issue_id: "issue-1", status: "completed" });
    const tree = RunRow({ task, issueId: task.issue_id });
    const [header, activity] = tree.props.children;
    const [link, cancel] = header.props.children;
    expect(activity).toBe(null);
    expect(cancel).toBe(null);
    link.props.onPress();
    expect(router.push).toHaveBeenCalledOnce();
  });
});
