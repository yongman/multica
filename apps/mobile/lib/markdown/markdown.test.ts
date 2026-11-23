// @vitest-environment node
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

// Exercise the real preprocessing, splitter and per-segment props. These
// headless tests do not simulate Yoga or native text/gesture rendering.
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  memo: (component: unknown) => component,
  useMemo: (create: () => unknown) => create(),
  useCallback: (callback: unknown) => callback,
}));
vi.mock("react-native", () => ({
  View: "View",
  Linking: { openURL: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("react-native-enriched-markdown", () => ({ EnrichedMarkdownText: "NativeMarkdown" }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("@/data/workspace-store", () => ({
  useWorkspaceStore: (select: (state: unknown) => unknown) => select({ currentWorkspaceSlug: "workspace" }),
}));
vi.mock("@/data/attachment-media", () => ({ openAttachment: vi.fn() }));
vi.mock("./markdown-style", () => ({
  useMarkdownStyle: () => ({ paragraph: { fontSize: 14, lineHeight: 24, marginBottom: 12 } }),
}));
vi.mock("./code-block", () => ({ CodeBlock: "CodeBlock" }));
vi.mock("./markdown-image", () => ({ MarkdownImage: "MarkdownImage" }));

import { Linking } from "react-native";
import { router } from "expo-router";
import { Markdown } from "./markdown";

type SegmentElement = ReactElement<{
  markdown?: string;
  code?: string;
  uri?: string;
  selectable?: boolean;
  containerStyle?: { minWidth: number; maxWidth: string; alignSelf: string };
  markdownStyle?: { paragraph: { lineHeight: number; marginBottom: number } };
  onLinkPress?: (event: { url: string }) => void;
}>;

function render(content: string, options = {}) {
  return Markdown({ content, ...options }) as ReactElement<{ children: SegmentElement[]; className: string }>;
}

const longToken = "abcdef0123456789".repeat(30);
const longUrl = `https://example.com/${longToken}?token=${longToken}`;

describe("Markdown width and content contract", () => {
  it.each([
    ["URL", longUrl],
    ["path", `/workspace/${longToken}/file.ts`],
    ["inline code", `中文 \`${longToken}\` English`],
    ["mixed styles", `**${longToken}** *${longToken}* ~~${longToken}~~`],
    ["heading", `# ${longToken}`],
    ["nested quote and task list", `> > - [ ] ${longToken}\n> >   - ${longUrl}`],
    ["mention", `[@${longToken}](mention://member/member-id)`],
    ["table", `| First | Last |\n| --- | --- |\n| ${longUrl} | ${longToken} |`],
    ["display math", `$$\n\\frac{${longToken}}{1+2+3}\n$$`],
    ["inline math", `$${longToken}$`],
  ])("bounds the native %s segment without mutating its source", (_name, content) => {
    const tree = render(content);
    const children = tree.props.children;
    expect(children).toHaveLength(1);
    expect(children[0]!.props.markdown).toBe(content);
    expect(tree.props.className).toContain("max-w-full");
    expect(children[0]!.props.containerStyle).toEqual({
      minWidth: 0,
      maxWidth: "100%",
      alignSelf: "stretch",
    });
  });

  it.each([
    ["comment props", false, false, 24, 12],
    ["selected comment props", true, false, 24, 12],
    ["reader props", true, false, 24, 12],
    ["compact message props", false, true, 20, 0],
  ])("preserves selection and paragraph styles with synthetic %s", (_name, selectable, compact, lineHeight, marginBottom) => {
    const tree = render(`Before\n\n\`\`\`text\n${longToken}\n\`\`\`\n\nAfter`, { selectable, compact });
    const [before, code, after] = tree.props.children;
    expect(tree.props.children.map((child) => child.type)).toEqual(["NativeMarkdown", "CodeBlock", "NativeMarkdown"]);
    expect(code!.props.code).toBe(longToken);
    for (const child of tree.props.children) expect(child.props.selectable).toBe(selectable);
    for (const child of [before!, after!]) {
      expect(child.props.markdownStyle!.paragraph).toMatchObject({ lineHeight, marginBottom });
    }
  });

  it("keeps image segments separate from constrained native prose", () => {
    const tree = render(`Before\n\n![wide](https://example.com/wide.png)\n\nAfter`);
    expect(tree.props.children.map((child) => child.type)).toEqual(["NativeMarkdown", "MarkdownImage", "NativeMarkdown"]);
    expect(tree.props.children[1]!.props.uri).toBe("https://example.com/wide.png");
  });

  it("keeps external link targets and internal mention navigation intact", () => {
    const onLinkPress = render(`[label](${longUrl})`).props.children[0]!.props.onLinkPress!;
    onLinkPress({ url: longUrl });
    expect(Linking.openURL).toHaveBeenCalledWith(longUrl);
    onLinkPress({ url: "mention://issue/issue-id" });
    expect(router.push).toHaveBeenCalledWith("/workspace/issue/issue-id");
  });
});
