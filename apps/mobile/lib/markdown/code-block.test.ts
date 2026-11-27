// @vitest-environment node
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ highlighted: null as unknown }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: () => {},
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial === null ? state.highlighted : initial, vi.fn()],
}));
vi.mock("react-native", () => ({ Pressable: "Pressable", ScrollView: "ScrollView", View: "View" }));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn().mockResolvedValue(undefined) }));
vi.mock("expo-haptics", () => ({ impactAsync: vi.fn(), ImpactFeedbackStyle: { Light: "light" } }));
vi.mock("react-native-svg", () => ({ default: "Svg", Path: "Path", Rect: "Rect" }));
vi.mock("expo", () => ({ requireNativeView: vi.fn(() => "NativeGuard") }));
vi.mock("@/components/ui/text", () => ({ Text: "Text" }));
vi.mock("@/lib/use-color-scheme", () => ({ useColorScheme: () => ({ isDarkColorScheme: false }) }));
vi.mock("@/lib/theme", () => ({ THEME: { light: {}, dark: {} } }));
vi.mock("@/lib/i18n", () => ({ useT: () => ({ t: (key: string) => key }) }));
vi.mock("./shiki", () => ({
  highlight: vi.fn(),
  resolveLang: () => "text",
  SHIKI_THEME_LIGHT: "light",
  SHIKI_THEME_DARK: "dark",
}));

import * as Clipboard from "expo-clipboard";
import { CodeBlock } from "./code-block";
import { ScrollGestureGuard } from "./scroll-gesture-guard";
import { ScrollGestureGuard as AndroidGuard } from "./scroll-gesture-guard.android";

type Element = ReactElement<{
  children?: Element | Element[] | string;
  selectable?: boolean;
  horizontal?: boolean;
  collapsable?: boolean;
  nestedScrollEnabled?: boolean;
  style?: object;
  code?: string;
  onPress?: () => Promise<void>;
}>;

function children(element: Element): Element[] {
  return Array.isArray(element.props.children) ? element.props.children : [element.props.children as Element];
}

describe("code viewport touch and copy contract", () => {
  afterEach(() => {
    state.highlighted = null;
    vi.useRealTimers();
  });

  it.each([false, true])("keeps plain and highlighted text selectable=%s within the guarded viewport", (selectable) => {
    const code = "const fullSource = 'start " + "0123456789 ".repeat(60) + "end';";
    for (const highlighted of [false, true]) {
      state.highlighted = highlighted
        ? { code, lang: "text", theme: "light", lines: [{ tokens: [{ content: code, color: "#000" }] }] }
        : null;
      const root = CodeBlock({ code, lang: "text", selectable }) as Element;
      const [header, guard] = children(root);
      expect(header!.props.code).toBe(code);
      expect(guard!.type).toBe(ScrollGestureGuard);
      const viewport = children(guard!)[0]!;
      expect(viewport.type).toBe("ScrollView");
      expect(viewport.props).toMatchObject({
        horizontal: true,
        nestedScrollEnabled: true,
        style: { flexGrow: 0, minWidth: 0, maxWidth: "100%" },
      });
      const content = children(viewport)[0]!;
      expect(content.props.selectable).toBe(selectable);
      const rendered = (content.type as (props: object) => Element)(content.props);
      if (highlighted) {
        const line = children(rendered)[0]!;
        expect(line.props.selectable).toBe(selectable);
        expect(children(line)[0]!.props.children).toBe(code);
      } else {
        expect(rendered.props.children).toBe(code);
      }
    }
  });

  it("keeps the copy button outside the drag host and copies unmodified source", async () => {
    vi.useFakeTimers();
    const code = "中文\tlong source\n" + "abc ".repeat(100);
    const header = children(CodeBlock({ code }) as Element)[0]!;
    const rendered = (header.type as (props: object) => Element)(header.props);
    const button = children(rendered).at(-1)!;
    expect(button.type).toBe("Pressable");
    await button.props.onPress!();
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(code);
  });

  it("adds a bounded native host only on Android and forwards the actual ScrollView", () => {
    const viewport = createElement("ScrollView", { horizontal: true });
    const guarded = AndroidGuard({ children: viewport }) as Element;
    expect(guarded.type).toBe("NativeGuard");
    expect(guarded.props.collapsable).toBe(false);
    expect(guarded.props.style).toEqual({ flexGrow: 0, minWidth: 0, maxWidth: "100%" });
    expect(guarded.props.children).toBe(viewport);
    expect(ScrollGestureGuard({ children: viewport })).toBe(viewport);
  });
});
