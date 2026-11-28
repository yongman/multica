// @vitest-environment node
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useMemo: (create: () => unknown) => create(),
}));
vi.mock("expo", () => ({ requireNativeView: vi.fn(() => "NativePreview") }));
vi.mock("react-native-webview", () => ({ WebView: "IOSWebView" }));

import { PreviewWebView as AndroidPreview } from "./preview-webview.android";
import { PreviewWebView as IOSPreview } from "./preview-webview";

describe("platform preview host contract", () => {
  it("uses the Android native gate with no incognito/cookie/cache mutation props", () => {
    const onMessage = vi.fn();
    const onFailure = vi.fn();
    const result = AndroidPreview({ document: "<p>offline</p>", fullscreen: false, onMessage, onFailure }) as ReactElement<Record<string, any>>;
    expect(result.type).toBe("NativePreview");
    expect(result.props).not.toHaveProperty("incognito");
    result.props.onMessage({ nativeEvent: { data: "bounded display message" } });
    expect(onMessage).toHaveBeenCalledWith("bounded display message");
    result.props.onFailure({ nativeEvent: { reason: "unsupported" } });
    expect(onFailure).toHaveBeenCalledWith("unsupported");
  });

  it("retains a per-view nonpersistent iOS store and blocks external navigation", () => {
    const result = IOSPreview({ document: "<p>offline</p>", fullscreen: true, onMessage: vi.fn(), onFailure: vi.fn() }) as ReactElement<Record<string, any>>;
    expect(result.type).toBe("IOSWebView");
    expect(result.props).toMatchObject({
      incognito: true, sharedCookiesEnabled: false, thirdPartyCookiesEnabled: false,
      allowFileAccess: false, allowUniversalAccessFromFileURLs: false, scrollEnabled: true,
    });
    expect(result.props.onShouldStartLoadWithRequest({ url: "https://tracking.example" })).toBe(false);
  });
});
