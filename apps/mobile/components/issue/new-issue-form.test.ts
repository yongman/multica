// @vitest-environment node
import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { Agent, RuntimeDevice, Squad } from "@multica/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NewIssueModal from "@/app/(app)/[workspace]/new-issue";
import { api } from "@/data/api";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { useSquadsRealtime } from "@/data/realtime/use-squads-realtime";
import { usePresenceRealtime } from "@/data/realtime/use-presence-realtime";
import { squadListOptions } from "@/data/queries/squads";
import { runtimeListOptions } from "@/data/queries/runtimes";

const state = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  platform: "android",
  qc: undefined as unknown as QueryClient,
  setups: [] as ((ws: unknown, wsId: string) => unknown)[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: () => {},
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    const index = state.cursor++;
    if (!(index in state.values))
      state.values[index] = typeof initial === "function" ? initial() : initial;
    return [
      state.values[index],
      (value: unknown) => {
        state.values[index] = value;
      },
    ];
  },
}));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Alert: { alert: vi.fn() },
  Keyboard: { dismiss: vi.fn() },
  Platform: {
    get OS() {
      return state.platform;
    },
  },
  ScrollView: "ScrollView",
  TextInput: "TextInput",
  View: "View",
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: "Screen" },
  router: { back: vi.fn(), push: vi.fn() },
  useLocalSearchParams: () => ({ workspace: "demo" }),
  useNavigation: () => ({ isFocused: () => true }),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 24 }),
}));
vi.mock("react-native-keyboard-controller", () => ({
  useKeyboardState: () => true,
}));
vi.mock("@/components/ui/keyboard-avoiding-view", () => ({
  KeyboardAvoidingView: "KeyboardAvoidingView",
}));
vi.mock("@/components/ui/actor-avatar", () => ({ ActorAvatar: "ActorAvatar" }));
vi.mock("@/components/ui/text", () => ({ Text: "Text" }));
vi.mock("@/components/ui/button", () => ({ Button: "Button" }));
vi.mock("@/components/issue/submit-issue-button", () => ({
  SubmitIssueButton: "SubmitIssueButton",
}));
vi.mock("@/components/issue/create-form-attribute-row", () => ({
  CreateFormAttributeRow: "CreateFormAttributeRow",
  CreateFormProjectChip: "CreateFormProjectChip",
}));
vi.mock("@/components/issue/mention-suggestion-bar", () => ({
  MentionSuggestionBar: "MentionSuggestionBar",
}));
vi.mock("@/components/issue/description-field", () => ({
  DescriptionField: "DescriptionField",
}));
vi.mock("@/lib/use-mention-input", () => ({
  useMentionInput: () => ({
    suggestionBar: { visible: true },
    serialize: () => "",
  }),
}));
vi.mock("@/lib/i18n", () => ({ useT: () => ({ t: (key: string) => key }) }));
vi.mock("@/data/auth-store", () => ({
  useAuthStore: (select: (s: unknown) => unknown) =>
    select({ user: { id: "user-1" } }),
}));
vi.mock("@/data/workspace-store", () => ({
  useWorkspaceStore: (select: (s: unknown) => unknown) =>
    select({
      currentWorkspaceId: "ws-1",
      currentWorkspaceSlug: "demo",
    }),
}));
vi.mock("@/data/stores/new-issue-draft-store", async (original) => {
  const { useNewIssueDraftStore: store } =
    await original<typeof import("@/data/stores/new-issue-draft-store")>();
  return {
    useNewIssueDraftStore: Object.assign(
      (select: (s: ReturnType<typeof store.getState>) => unknown) =>
        select(store.getState()),
      store,
    ),
  };
});
vi.mock("@/data/mutations/issues", () => ({
  useCreateIssue: () => ({ isPending: false }),
  useQuickCreateIssue: () => ({ isPending: false }),
}));
vi.mock("@/data/api", () => ({
  api: { listSquads: vi.fn(), listRuntimes: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock("@tanstack/react-query", async (original) => ({
  ...(await original<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => state.qc,
  // Read real QueryClient data each time the screen is evaluated. Real active
  // QueryObservers below perform the network/refetch lifecycle after events.
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => ({
    data: state.qc.getQueryData(queryKey),
    isError: false,
  }),
}));
vi.mock("@/lib/use-ws-subscriptions", () => ({
  useWSSubscriptions: (setup: (ws: unknown, wsId: string) => unknown) =>
    state.setups.push(setup),
}));

const agent = {
  id: "leader",
  runtime_id: "runtime",
  name: "Leader",
  permission_mode: "private",
  owner_id: "user-1",
  archived_at: null,
} as Agent;
const squad = {
  id: "squad",
  name: "Team",
  leader_id: agent.id,
  archived_at: null,
} as Squad;
const runtime = { id: "runtime", status: "online" } as RuntimeDevice;
const cleanup: (() => void)[] = [];

type Node = ReactElement<Record<string, any>>;
function find(
  node: ReactNode,
  match: (node: Node) => boolean,
): Node | undefined {
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const element = node as Node;
  if (match(element)) return element;
  for (const child of [element.props.children].flat()) {
    const found = find(child, match);
    if (found) return found;
  }
}

function render() {
  state.cursor = 0;
  const modal = NewIssueModal() as ReactElement<{ initialProject: null }>;
  const form = modal.type as (props: { initialProject: null }) => ReactNode;
  return form(modal.props);
}

function submit(tree: ReactNode) {
  const screen = find(tree, (node) => node.type === "Screen")!;
  return screen.props.options.headerRight().props;
}

function prompt(tree: ReactNode) {
  return find(
    tree,
    (node) => node.props.accessibilityLabel === "new.agent_prompt",
  )!.props;
}

function readyForm() {
  useNewIssueDraftStore.getState().setCreator({ type: "squad", id: squad.id });
  const tree = render();
  find(
    tree,
    (node) => node.type === "Button" && node.props["aria-selected"] === false,
  )!.props.onPress();
  prompt(render()).onChangeText("Preserve this request");
  expect(submit(render()).disabled).toBe(false);
}

function subscriptions(hook: () => void) {
  hook();
  const handlers = new Map<string, () => void>();
  const ws = {
    on: (event: string, callback: () => void) => {
      handlers.set(event, callback);
      return () => {};
    },
    onReconnect: (callback: () => void) => {
      handlers.set("reconnect", callback);
      return () => {};
    },
  };
  state.setups.at(-1)!(ws, "ws-1");
  return handlers;
}

beforeEach(() => {
  state.values = [];
  state.setups = [];
  state.platform = "android";
  state.qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  state.qc.setQueryData(["agents", "ws-1"], [agent]);
  state.qc.setQueryData(
    ["members", "ws-1"],
    [{ user_id: "user-1", role: "owner" }],
  );
  state.qc.setQueryData(["squads", "ws-1"], [squad]);
  state.qc.setQueryData(["runtimes", "ws-1"], [runtime]);
  useNewIssueDraftStore.getState().reset();
  vi.mocked(api.listSquads).mockReset();
  vi.mocked(api.listRuntimes).mockReset();
});
afterEach(() => {
  for (const unsubscribe of cleanup.splice(0)) unsubscribe();
  state.qc.clear();
});

describe("new issue regression wiring (native drawing mocked)", () => {
  it.each([
    ["squad:updated", { ...squad, archived_at: "2026-11-28" }],
    ["squad:updated", { ...squad, leader_id: "unavailable-leader" }],
    ["squad:deleted", null],
    ["reconnect", null],
  ] as const)(
    "blocks a selected squad after %s and keeps the prompt",
    async (event, changed) => {
      readyForm();
      const observer = new QueryObserver(state.qc, squadListOptions("ws-1"));
      cleanup.push(observer.subscribe(() => {}));
      const next = changed ? [changed] : [];
      vi.mocked(api.listSquads).mockResolvedValue(next);
      subscriptions(useSquadsRealtime).get(event)!();
      await vi.waitFor(() =>
        expect(state.qc.getQueryData(["squads", "ws-1"])).toEqual(next),
      );
      expect(submit(render()).disabled).toBe(true);
      expect(prompt(render()).value).toBe("Preserve this request");
    },
  );

  it("blocks an owner-visible runtime after an offline event without an agent projection", async () => {
    readyForm();
    const observer = new QueryObserver(state.qc, runtimeListOptions("ws-1"));
    cleanup.push(observer.subscribe(() => {}));
    const offline = [{ ...runtime, status: "offline" as const }];
    vi.mocked(api.listRuntimes).mockResolvedValue(offline);
    subscriptions(usePresenceRealtime).get("agent:status")!();
    await vi.waitFor(() =>
      expect(state.qc.getQueryData(["runtimes", "ws-1"])).toEqual(offline),
    );
    expect(submit(render()).disabled).toBe(true);
    expect(prompt(render()).value).toBe("Preserve this request");
  });

  it.each(["android", "ios"])(
    "reserves the input and footer when %s keyboard content is only 170dp tall",
    (platform) => {
      state.platform = platform;
      const tree = render();
      find(
        tree,
        (node) =>
          node.type === "View" && node.props.onLayout && !node.props.role,
      )!.props.onLayout({ nativeEvent: { layout: { height: 170 } } });
      find(tree, (node) => node.props.role === "tablist")!.props.onLayout({
        nativeEvent: { layout: { height: 72 } },
      });
      const updated = render();
      const suggestions = find(
        updated,
        (node) => node.type === "MentionSuggestionBar",
      )!;
      expect(suggestions.props.maxHeight).toBe(34);
      expect(suggestions.props.maxHeight + 72 + 64).toBe(170);
      expect(
        find(updated, (node) => node.type === "KeyboardAvoidingView")!.props
          .behavior,
      ).toBe(platform === "ios" ? "padding" : undefined);
      expect(
        find(updated, (node) => node.props.role === "tablist")!.props.className,
      ).toContain("shrink-0");
      expect(
        find(updated, (node) => node.type === "ScrollView")!.props.className,
      ).toContain("min-h-0");
    },
  );
});
