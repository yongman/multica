import { useMemo } from "react";
import { WebView } from "react-native-webview";
import { isPreviewNavigationAllowed } from "./preview-document";
import type { PreviewWebViewProps } from "./preview-webview.types";

/** iOS uses a per-view nonpersistent store; Android has its own native host. */
export function PreviewWebView({ document, fullscreen, onMessage, onFailure }: PreviewWebViewProps) {
  const source = useMemo(() => ({ html: document }), [document]);
  return (
    <WebView
      source={source}
      style={{ flex: 1, backgroundColor: "transparent" }}
      containerStyle={{ minWidth: 0, maxWidth: "100%" }}
      originWhitelist={["*"]}
      onShouldStartLoadWithRequest={({ url }) => isPreviewNavigationAllowed(url)}
      onOpenWindow={() => {}}
      onMessage={({ nativeEvent }) => onMessage(nativeEvent.data)}
      javaScriptEnabled
      javaScriptCanOpenWindowsAutomatically={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      domStorageEnabled={false}
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      incognito
      cacheEnabled={false}
      geolocationEnabled={false}
      mediaPlaybackRequiresUserAction
      allowsFullscreenVideo={false}
      allowsAirPlayForMediaPlayback={false}
      mixedContentMode="never"
      setSupportMultipleWindows
      textZoom={100}
      scrollEnabled={fullscreen}
      nestedScrollEnabled={false}
      bounces={false}
      onError={() => onFailure("failed")}
      onRenderProcessGone={() => onFailure("failed")}
      onContentProcessDidTerminate={() => onFailure("failed")}
    />
  );
}
