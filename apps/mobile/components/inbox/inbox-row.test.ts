// @vitest-environment node
import type { InboxItem, IssueStatusEntry } from "@multica/core/types";
import { expect, it, vi } from "vitest";
import { InboxRow } from "./inbox-row";
import { buildIssueStatusCatalog } from "@/lib/issue-status";

const state = vi.hoisted(() => ({ statuses: undefined as IssueStatusEntry[] | undefined }));
vi.mock("react-native", () => ({ Platform: { OS: "android" }, Pressable: "Pressable", View: "View" }));
vi.mock("@/components/ui/text", () => ({ Text: "Text" }));
vi.mock("@/components/ui/actor-avatar", () => ({ ActorAvatar: "Avatar" }));
vi.mock("@/components/ui/status-icon", () => ({ StatusIcon: "StatusIcon" }));
vi.mock("./detail-label", () => ({ InboxDetailLabel: "InboxDetailLabel" }));
vi.mock("@/lib/inbox-display", () => ({ getInboxDisplayTitle: () => "Issue" }));
vi.mock("@/lib/time-ago", () => ({ timeAgo: () => "" }));
vi.mock("@/lib/use-issue-statuses", () => ({
  useIssueStatuses: () => buildIssueStatusCatalog(state.statuses),
}));
vi.mock("@/lib/use-action-sheet", () => ({ useActionSheet: () => ({}) }));
vi.mock("@/lib/i18n", () => ({ useT: () => ({}) }));
vi.mock("@/data/mutations/issues", () => ({ useUpdateIssue: () => ({ isPending: false }) }));
vi.mock("@/data/workspace-store", () => ({ useWorkspaceStore: () => "workspace-1" }));

const shipped = { key: "shipped", category: "done" } as IssueStatusEntry;
const QA = { key: "qa", category: "started" } as IssueStatusEntry;

it.each([
  { status: null, catalog: [shipped], eligible: false },
  { status: "shipped", catalog: undefined, eligible: false },
  { status: "shipped", catalog: [], eligible: false },
  { status: "shipped", catalog: [shipped], eligible: false },
  { status: "todo", catalog: undefined, eligible: true },
  { status: "qa", catalog: [QA], eligible: true },
] as const)("sets Inbox completion eligibility for $status to $eligible", ({ status, catalog, eligible }) => {
  state.statuses = catalog ? [...catalog] : undefined;
  const item = { issue_id: "issue-1", issue_status: status } as InboxItem;
  const onPress = vi.fn();
  const row = InboxRow({ item, onPress });

  expect(typeof row.props.onLongPress === "function").toBe(eligible);
  expect(row.props.onPress).toBe(onPress);
});
