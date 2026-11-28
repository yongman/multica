import type {
  Agent,
  MemberWithUser,
  RuntimeDevice,
  Squad,
} from "@multica/core/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssigneePickerBody } from "./assignee-picker-body";

const state = vi.hoisted(() => ({
  agents: [] as Agent[],
  squads: [] as Squad[],
  members: [] as MemberWithUser[],
  runtimes: [] as RuntimeDevice[],
  failed: "",
  loading: "",
  refetch: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useMemo: (fn: () => unknown) => fn(),
}));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  FlatList: "FlatList",
  Pressable: "Pressable",
  View: "View",
}));
vi.mock("nativewind", () => ({
  useColorScheme: () => ({ colorScheme: "light" }),
}));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
vi.mock("@/components/ui/text", () => ({ Text: "Text" }));
vi.mock("@/components/ui/button", () => ({ Button: "Button" }));
vi.mock("@/components/ui/actor-avatar", () => ({ ActorAvatar: "ActorAvatar" }));
vi.mock("@/lib/use-scroll-to-top-on-change", () => ({
  useScrollToTopOnChange: () => null,
}));
vi.mock("@/lib/theme", () => ({
  THEME: { light: { primary: "#000" }, dark: { primary: "#fff" } },
}));
vi.mock("@/lib/i18n", () => ({ useT: () => ({ t: (key: string) => key }) }));
vi.mock("@/data/auth-store", () => ({
  useAuthStore: (select: (s: unknown) => unknown) =>
    select({ user: { id: "user-1" } }),
}));
vi.mock("@/data/workspace-store", () => ({
  useWorkspaceStore: (select: (s: unknown) => unknown) =>
    select({ currentWorkspaceId: "ws-1" }),
}));
vi.mock("@/data/api", () => ({ api: {} }));
vi.mock("@tanstack/react-query", () => ({
  queryOptions: (options: unknown) => options,
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data:
      queryKey[0] === state.loading
        ? undefined
        : state[queryKey[0] as "agents" | "squads" | "members" | "runtimes"],
    isError: queryKey[0] === state.failed,
    refetch: state.refetch,
  }),
}));

const agent = {
  id: "agent-1",
  name: "Builder",
  runtime_id: "runtime-1",
  runtime_availability: "online",
  owner_id: "user-1",
  permission_mode: "private",
  archived_at: null,
} as Agent;
const squad = {
  id: "squad-1",
  name: "Engineering",
  leader_id: agent.id,
  archived_at: null,
} as Squad;
const member = {
  user_id: "user-1",
  name: "Ray",
  role: "member",
} as MemberWithUser;

function render(mode: "assign" | "quick-create" = "quick-create", query = "") {
  const onChange = vi.fn();
  const list = AssigneePickerBody({
    mode,
    query,
    value: { type: "squad", id: squad.id },
    onChange,
  });
  return { props: list.props, onChange };
}

describe("assignee/creator picker wiring (native modules mocked)", () => {
  beforeEach(() => {
    state.agents = [agent];
    state.squads = [squad];
    state.members = [member];
    state.runtimes = [];
    state.failed = "";
    state.loading = "";
    state.refetch.mockClear();
  });

  it("groups squads and agents, excludes people and unassigned, and submits the squad type", () => {
    const { props, onChange } = render();
    expect(props.data.map((row: { kind: string }) => row.kind)).toEqual([
      "section",
      "squad",
      "section",
      "agent",
    ]);
    const row = props.renderItem({ item: props.data[1] });
    expect(row.props.accessibilityState).toEqual({
      selected: true,
      disabled: false,
    });
    row.props.onPress();
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      type: "squad",
      id: squad.id,
    });
  });

  it("searches squad names and keeps the section header", () => {
    const { props } = render("quick-create", " engine ");
    expect(props.data).toEqual([
      { kind: "section", group: "squads" },
      { kind: "squad", squad },
    ]);
  });

  it.each<Partial<Agent>>([
    { runtime_id: "" },
    { runtime_availability: "offline" },
    { owner_id: "other-user" },
  ])("hides unusable quick-create actors: %j", (patch) => {
    state.agents = [{ ...agent, ...patch }];
    expect(render().props.data).toEqual([]);
  });

  it("preserves manual people, unassigned, selection pinning and offline squad assignment", () => {
    state.agents = [{ ...agent, runtime_availability: "offline" }];
    const { props, onChange } = render("assign");
    expect(props.data.map((row: { kind: string }) => row.kind)).toEqual([
      "unassigned",
      "squad",
      "member",
      "agent",
    ]);
    const row = props.renderItem({ item: props.data[1] });
    expect(row.props.disabled).toBe(false);
    row.props.onPress();
    expect(onChange).toHaveBeenCalledWith({ type: "squad", id: squad.id });
  });

  it("disables a manual squad whose leader has no invocation grant", () => {
    state.agents = [{ ...agent, owner_id: "other-user" }];
    const { props } = render("assign");
    expect(props.renderItem({ item: props.data[1] }).props.disabled).toBe(true);
  });

  it.each(["agents", "squads", "members", "runtimes"])(
    "does not expose cached rows after %s fails or before it loads",
    (key) => {
      state.failed = key;
      expect(render().props.data).toEqual([]);
      state.failed = "";
      state.loading = key;
      expect(render().props.data).toEqual([]);
    },
  );

  it("removes an owner-visible squad when its runtime goes offline without a projection", () => {
    state.agents = [{ ...agent, runtime_availability: undefined }];
    state.runtimes = [{ id: "runtime-1", status: "online" } as RuntimeDevice];
    expect(
      render().props.data.some((row: { kind: string }) => row.kind === "squad"),
    ).toBe(true);
    state.runtimes = [{ ...state.runtimes[0], status: "offline" }];
    expect(render().props.data).toEqual([]);
  });

  it.each(["failed", "loading"] as const)(
    "keeps people and Unassigned usable when squads are %s",
    (condition) => {
      state[condition] = "squads";
      const { props, onChange } = render("assign");
      const unassigned = props.data.find(
        (row: { kind: string }) => row.kind === "unassigned",
      );
      const person = props.data.find(
        (row: { kind: string }) => row.kind === "member",
      );
      props.renderItem({ item: unassigned }).props.onPress();
      props.renderItem({ item: person }).props.onPress();
      expect(onChange.mock.calls).toEqual([
        [null],
        [{ type: "member", id: member.user_id }],
      ]);
      expect(props.ListFooterComponent).not.toBeNull();
    },
  );

  it("provides a retry action beside the failed assignment group, including stale cached rows", () => {
    state.failed = "squads";
    const { props } = render("assign");
    expect(
      props.data.some((row: { kind: string }) => row.kind === "squad"),
    ).toBe(false);
    const failedGroup = props.ListFooterComponent.props.children.find(Boolean);
    failedGroup.props.children[1].props.onPress();
    expect(state.refetch).toHaveBeenCalledOnce();
  });
});
