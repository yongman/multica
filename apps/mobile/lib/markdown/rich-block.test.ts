// @vitest-environment node
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void | (() => void))[],
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  memo: (component: unknown) => component,
  useMemo: (create: () => unknown) => create(),
  useCallback: (callback: unknown) => callback,
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (next: unknown) => { hooks.values[index] = next; }];
  },
}));
vi.mock("react-native", () => ({
  View: "View", Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", ActivityIndicator: "Spinner",
}));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeAreaView" }));
vi.mock("./preview-webview", () => ({ PreviewWebView: "PreviewWebView" }));
vi.mock("@/components/ui/button", () => ({ Button: "Button" }));
vi.mock("@/components/ui/icon-button", () => ({ IconButton: "IconButton" }));
vi.mock("@/components/ui/text", () => ({ Text: "Text" }));
vi.mock("@/lib/i18n", () => ({ useT: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/use-color-scheme", () => ({ useColorScheme: () => ({ isDarkColorScheme: false }) }));
vi.mock("@/lib/theme", () => ({ THEME: { light: { background: "#fff", foreground: "#111" } } }));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));
vi.mock("expo-haptics", () => ({ impactAsync: vi.fn(), ImpactFeedbackStyle: { Light: "light" } }));
vi.mock("react-native-svg", () => ({ default: "Svg", Path: "Path", Rect: "Rect" }));
vi.mock("./scroll-gesture-guard", () => ({ ScrollGestureGuard: "ScrollGestureGuard" }));
vi.mock("./shiki", () => ({
  highlight: vi.fn(), resolveLang: () => null,
  SHIKI_THEME_DARK: "dark", SHIKI_THEME_LIGHT: "light",
}));

import { RichBlock } from "./rich-block";

// Inspect real component state/callback wiring, without claiming to render
// Fabric, platform WebViews, modal animation, or browser gestures.
type Element = ReactElement<Record<string, any>>;
function descendants(element: unknown): Element[] {
  if (Array.isArray(element)) return element.flatMap(descendants);
  if (!element || typeof element !== "object" || !("props" in element)) return [];
  const node = element as Element;
  return [node, ...descendants(node.props.children)];
}
function find(root: Element, type: string, predicate: (props: Element["props"]) => boolean = () => true) {
  return descendants(root).find((element) => (
    element.type === type || (typeof element.type === "function" && element.type.name === type)
  ) && predicate(element.props))!;
}
function expandCodeHeaders(element: Element): Element {
  if (typeof element.type === "function" && ["CodeBlock", "CodeBlockHeader"].includes(element.type.name)) {
    return expandCodeHeaders((element.type as (props: object) => Element)(element.props));
  }
  const content = element.props.children;
  const expand = (child: unknown): unknown => child && typeof child === "object" && "props" in child
    ? expandCodeHeaders(child as Element) : child;
  return {
    ...element,
    props: { ...element.props, children: Array.isArray(content) ? content.map(expand) : expand(content) },
  };
}
function render(code = "<h1>Preview</h1>", selectable = false): Element {
  hooks.cursor = 0;
  const wrapper = RichBlock({ code, kind: "html", title: "Chart", selectable }) as Element;
  return (wrapper.type as (props: object) => Element)(wrapper.props);
}

beforeEach(() => {
  hooks.values = [];
  hooks.effects = [];
  hooks.cursor = 0;
});
afterEach(() => vi.useRealTimers());

describe("rich block interaction wiring", () => {
  it("defaults to preview, then shows unmodified source with the caller's selection contract", () => {
    let root = render();
    expect(find(root, "CodeBlock")).toBeUndefined();
    expect(find(root, "CodeBlockHeader").props).toMatchObject({ code: "<h1>Preview</h1>", lang: "Chart" });
    find(root, "Button", (props) => props.accessibilityState?.selected === false).props.onPress();
    root = render();
    expect(find(root, "CodeBlock").props).toMatchObject({ code: "<h1>Preview</h1>", lang: "html", selectable: false });
    // Inline source keeps the existing code gesture route, without a second
    // vertical scroller competing with the outer comment list.
    expect(find(root, "ScrollView")).toBeUndefined();
  });

  it("moves a single preview to full screen and handles Android back", () => {
    let root = render();
    find(root, "IconButton").props.onPress();
    root = render();
    const modal = find(root, "Modal");
    expect(modal.props.visible).toBe(true);
    const surfaces = descendants(root).filter((element) => typeof element.props.document === "string");
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]!.props.fullscreen).toBe(true);
    modal.props.onRequestClose();
    expect(find(render(), "Modal").props.visible).toBe(false);
  });

  it("shows source and a retry after a renderer error", () => {
    let root = render();
    const surface = descendants(root).find((element) => typeof element.props.document === "string")!;
    surface.props.onError("Invalid diagram");
    root = render();
    expect(find(root, "CodeBlock")).toBeDefined();
    expect(descendants(root).some((element) => element.props.children === "Invalid diagram")).toBe(true);
    find(root, "Button", (props) => props.variant === "outline").props.onPress();
    expect(find(render(), "CodeBlock")).toBeUndefined();
  });

  it("uses source without mounting a WebView for oversized blocks", () => {
    const root = render("x".repeat(256_001));
    expect(find(root, "CodeBlock")).toBeDefined();
    expect(find(root, "Button", (props) => props.disabled === true)).toBeDefined();
    expect(descendants(root).some((element) => typeof element.props.document === "string")).toBe(false);
  });

  it("bounds the inline viewport, disables touch interception and cleans up the load timeout", () => {
    vi.useFakeTimers();
    const root = render();
    const surface = descendants(root).find((element) => typeof element.props.document === "string")!;
    hooks.values = [];
    hooks.cursor = 0;
    hooks.effects = [];
    const rendered = (surface.type as (props: object) => Element)(surface.props);
    const cleanup = hooks.effects[0]!();
    expect(vi.getTimerCount()).toBe(1);
    expect(rendered.props.style).toMatchObject({ minWidth: 0, maxWidth: "100%" });
    expect(find(rendered, "View", (props) => props.pointerEvents === "none")).toBeDefined();
    const webview = find(rendered, "PreviewWebView");
    expect(webview.props.fullscreen).toBe(false);
    webview.props.onMessage('{"__multicaMobilePreview":1,"type":"height","height":200}');
    expect(vi.getTimerCount()).toBe(0);
    if (typeof cleanup === "function") cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses actual source selection after failure and retries when Preview is tapped", () => {
    let root = render();
    descendants(root).find((element) => typeof element.props.document === "string")!.props.onError("Invalid diagram");
    root = render();
    const modes = descendants(root).filter((element) => element.type === "Button" && element.props.accessibilityState);
    expect(modes.map((element) => element.props.accessibilityState.selected)).toEqual([false, true]);
    modes[0]!.props.onPress();
    root = render();
    expect(find(root, "CodeBlock")).toBeUndefined();
    expect(descendants(root).filter((element) => element.type === "Button" && element.props.accessibilityState).map((element) => element.props.accessibilityState.selected)).toEqual([true, false]);
  });

  it.each([false, true])("has one copy owner in source/error with fullscreen=%s", (fullscreen) => {
    let root = render();
    if (fullscreen) {
      find(root, "IconButton").props.onPress();
      root = render();
    }
    find(root, "Button", (props) => props.accessibilityState?.selected === false).props.onPress();
    root = render();
    expect(descendants(expandCodeHeaders(root)).filter((element) => element.props.accessibilityLabel === "code.copy")).toHaveLength(1);
    expect(find(root, "CodeBlock").props.showHeader).toBe(false);
    find(root, "Button", (props) => props.accessibilityState?.selected === false).props.onPress();
    root = render();
    descendants(root).find((element) => typeof element.props.document === "string")!.props.onError("Invalid diagram");
    root = render();
    expect(descendants(expandCodeHeaders(root)).filter((element) => element.props.accessibilityLabel === "code.copy")).toHaveLength(1);
    expect(find(root, "CodeBlock").props.showHeader).toBe(false);
    // Also exercise explicit Source selection in the same inline/modal host.
    find(root, "Button", (props) => props.accessibilityState?.selected === true).props.onPress();
    root = render();
    expect(descendants(expandCodeHeaders(root)).filter((element) => element.props.accessibilityLabel === "code.copy")).toHaveLength(1);
    expect(find(root, "CodeBlock").props.showHeader).toBe(false);
  });

  it("clears a pending timeout when the WebView unmounts", () => {
    vi.useFakeTimers();
    const surface = descendants(render()).find((element) => typeof element.props.document === "string")!;
    hooks.cursor = 0;
    hooks.values = [];
    hooks.effects = [];
    (surface.type as (props: object) => Element)(surface.props);
    const cleanup = hooks.effects[0]!();
    if (typeof cleanup === "function") cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });
});
