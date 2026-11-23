// @vitest-environment node
import { Children, isValidElement, type ReactElement } from "react";
import type { TimelineEntry } from "@multica/core/types";
import { describe, expect, it, vi } from "vitest";
import { CommentCard } from "./comment-card";

const selection = vi.hoisted(() => ({ selectingId: null as string | null }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: vi.fn(),
  useCallback: (callback: unknown) => callback,
  useMemo: (create: () => unknown) => create(),
}));
vi.mock("react-native", () => ({ Pressable: "Pressable", View: "View" }));
vi.mock("react-native-reanimated", () => ({ default: { View: "AnimatedView" } }));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({}), useQueryClient: () => ({}) }));
vi.mock("@/components/ui/text", () => ({ Text: "Text" }));
vi.mock("@/components/ui/actor-avatar", () => ({ ActorAvatar: "ActorAvatar" }));
vi.mock("@/data/use-actor-name", () => ({ useActorLookup: () => ({ getName: () => "Author" }) }));
vi.mock("@/lib/markdown", () => ({ Markdown: "Markdown" }));
vi.mock("@/components/issue/comment-attachment-list", () => ({ CommentAttachmentList: "CommentAttachmentList" }));
vi.mock("@/data/mutations/issues", () => ({
  discardFailedComment: vi.fn(),
  useCreateComment: () => ({}),
  useToggleCommentReaction: () => ({}),
}));
vi.mock("@/data/auth-store", () => ({ useAuthStore: (select: (value: unknown) => unknown) => select({ user: { id: "user" } }) }));
vi.mock("@/data/workspace-store", () => ({ useWorkspaceStore: (select: (value: unknown) => unknown) => select({ currentWorkspaceId: "workspace" }) }));
vi.mock("@/data/queries/issues", () => ({ issueAttachmentsOptions: () => ({}) }));
vi.mock("@/data/stores/failed-comments-store", () => ({ useFailedCommentsStore: (select: (value: unknown) => unknown) => select({ failed: {} }) }));
vi.mock("@/lib/use-color-scheme", () => ({ useColorScheme: () => ({ colorScheme: "light" }) }));
vi.mock("@/lib/theme", () => ({ THEME: { light: {} } }));
vi.mock("@/lib/time-ago", () => ({ timeAgo: () => "just now" }));
vi.mock("@/lib/i18n", () => ({ useT: () => ({ t: (key: string) => key }) }));
vi.mock("./reaction-bar", () => ({ ReactionBar: "ReactionBar" }));
vi.mock("./comment-context-menu", () => ({ useCommentLongPress: () => ({ onLongPress: vi.fn(), isPressed: false }) }));
vi.mock("@/data/comment-select-store", () => ({ useCommentSelectStore: (select: (value: unknown) => unknown) => select(selection) }));

type Element = ReactElement<{
  children?: React.ReactNode;
  className?: string;
  entry?: TimelineEntry;
  content?: string;
  selectable?: boolean;
}>;

function find(element: Element, predicate: (node: Element) => boolean): Element | undefined {
  if (predicate(element)) return element;
  for (const child of Children.toArray(element.props.children)) {
    if (!isValidElement(child)) continue;
    const found = find(child as Element, predicate);
    if (found) return found;
  }
}

const content = "https://example.com/" + "0123456789abcdef".repeat(50);
const root: TimelineEntry = {
  id: "root", type: "comment", content, created_at: "2026-11-01T00:00:00Z",
  actor_type: "member", actor_id: "user", actor_name: "Author".repeat(50),
};
const replies = [
  { ...root, id: "reply", parent_id: "root" },
  { ...root, id: "nested", parent_id: "reply" },
];

describe("comment body width wiring", () => {
  it.each(["root", "reply", "nested"])("bounds %s in normal and selection modes", (id) => {
    for (const selectingId of [null, id]) {
      selection.selectingId = selectingId;
      const card = CommentCard({ entry: root, replies, issueId: "issue", issueIdentifier: undefined }) as Element;
      const bodyElement = find(card, (node) => node.props.entry?.id === id)!;
      const body = (bodyElement.type as (props: unknown) => Element)(bodyElement.props);
      expect(body.props.className).toContain("max-w-full");
      const markdown = find(body, (node) => node.type === "Markdown")!;
      expect(markdown.props.content).toBe(content);
      expect(markdown.props.selectable).toBe(selectingId === id);
      expect(body.type).toBe(selectingId === id ? "View" : "Pressable");
      selection.selectingId = null;
    }
  });
});
