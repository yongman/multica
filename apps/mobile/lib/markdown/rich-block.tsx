import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { CodeBlock, CodeBlockHeader } from "./code-block";
import {
  buildPreviewDocument,
  isPreviewNavigationAllowed,
  MERMAID_MAX_SOURCE_LENGTH,
  PREVIEW_MAX_SOURCE_LENGTH,
  readPreviewMessage,
  type PreviewKind,
} from "./preview-document";
import { previewTheme } from "./preview-theme";

interface Props {
  code: string;
  kind: PreviewKind;
  title?: string | null;
  selectable?: boolean;
}

export const RichBlock = memo(function RichBlock(props: Props) {
  // Recycled cells/new source reset errors and selection; appending prose to a
  // streaming message preserves this instance and its WebView document.
  return <RichBlockContent key={`${props.kind}:${props.code}`} {...props} />;
});

function RichBlockContent({ code, kind, title, selectable = true }: Props) {
  const { t } = useT("editor");
  const { t: common } = useT("common");
  const { isDarkColorScheme } = useColorScheme();
  const palette = isDarkColorScheme ? THEME.dark : THEME.light;
  const tooLarge = code.length > (kind === "mermaid" ? MERMAID_MAX_SOURCE_LENGTH : PREVIEW_MAX_SOURCE_LENGTH);
  const [showSource, setShowSource] = useState(tooLarge);
  const [fullscreen, setFullscreen] = useState(false);
  const [height, setHeight] = useState(180);
  const [inlineHeight, setInlineHeight] = useState(268);
  const [error, setError] = useState<string | null>(null);
  const document = useMemo(() => {
    if (tooLarge) return "";
    // The generated IIFE is data loaded only for Mermaid, never evaluated by
    // Hermes. postinstall generates it from the pinned package for offline APKs.
    const mermaidRuntime: string = kind === "mermaid"
      ? require("./mermaid-runtime.generated").default
      : "";
    return buildPreviewDocument({
      code, kind, theme: previewTheme(palette, isDarkColorScheme), mermaidRuntime,
    });
  }, [code, kind, palette, isDarkColorScheme, tooLarge]);

  const toolbar = (
    <View className="gap-1 border-b border-border px-2 py-1">
      <CodeBlockHeader code={code} lang={title || kind.toUpperCase()} />
      <View className="flex-row items-center gap-1">
        <Button
          size="sm"
          variant={!showSource ? "secondary" : "ghost"}
          disabled={tooLarge}
          accessibilityState={{ selected: !showSource, disabled: tooLarge }}
          onPress={() => setShowSource(false)}
        >
          <Text>{t("rich.preview")}</Text>
        </Button>
        <Button
          size="sm"
          variant={showSource ? "secondary" : "ghost"}
          accessibilityState={{ selected: showSource }}
          onPress={() => setShowSource(true)}
        >
          <Text>{t("rich.source")}</Text>
        </Button>
        <View className="flex-1" />
        <IconButton
          name={fullscreen ? "close" : "expand-outline"}
          accessibilityLabel={fullscreen ? common("actions.close") : t("rich.fullscreen")}
          onPress={() => setFullscreen(!fullscreen)}
        />
      </View>
    </View>
  );

  const body = showSource || error || tooLarge ? (
    <View className={fullscreen ? "flex-1" : undefined}>
      {error || tooLarge ? (
        <View accessibilityRole="alert" className="gap-1 p-3">
          <Text className="text-sm text-muted-foreground">{t(tooLarge ? "rich.too_large" : "rich.failed")}</Text>
          {error ? <Text className="text-xs text-muted-foreground" selectable>{error}</Text> : null}
          {!tooLarge ? (
            <Button size="sm" variant="outline" onPress={() => { setError(null); setShowSource(false); }}>
              <Text>{t("rich.retry")}</Text>
            </Button>
          ) : null}
        </View>
      ) : null}
      {fullscreen ? (
        <ScrollView style={{ flex: 1 }}>
          <CodeBlock code={code} lang={kind} selectable={selectable} />
        </ScrollView>
      ) : <CodeBlock code={code} lang={kind} selectable={selectable} />}
    </View>
  ) : (
    <PreviewSurface
      key={isDarkColorScheme ? "dark" : "light"}
      document={document}
      fullscreen={fullscreen}
      height={height}
      onHeight={setHeight}
      onError={setError}
      onExpand={() => setFullscreen(true)}
    />
  );

  return (
    <View
      className="min-w-0 max-w-full overflow-hidden rounded-md border border-border"
      onLayout={fullscreen ? undefined : (event) => setInlineHeight(event.nativeEvent.layout.height)}
    >
      {fullscreen ? (
        // Keep the inline allocation while moving to the modal. Only one
        // WebView exists per block, including while the viewer is open.
        <View style={{ height: inlineHeight }} />
      ) : (
        <>{toolbar}{body}</>
      )}
      <Modal
        visible={fullscreen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setFullscreen(false)}
      >
        {fullscreen ? (
          <SafeAreaView className="flex-1 bg-background">
            {toolbar}
            {body}
          </SafeAreaView>
        ) : null}
      </Modal>
    </View>
  );
}

interface SurfaceProps {
  document: string;
  fullscreen: boolean;
  height: number;
  onHeight: (height: number) => void;
  onError: (message: string) => void;
  onExpand: () => void;
}

function PreviewSurface({ document, fullscreen, height, onHeight, onError, onExpand }: SurfaceProps) {
  const { t } = useT("editor");
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const source = useMemo(() => ({ html: document }), [document]);
  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => {
    timer.current = setTimeout(() => onError(t("rich.timeout")), 15_000);
    return clearTimer;
  }, [onError, clearTimer, t]);
  const onMessage = useCallback(({ nativeEvent }: WebViewMessageEvent) => {
    const message = readPreviewMessage(nativeEvent.data);
    if (!message) return;
    clearTimer();
    setLoading(false);
    if (message.type === "height") onHeight(message.height);
    else onError(message.message);
  }, [onHeight, onError, clearTimer]);

  return (
    <View style={fullscreen ? { flex: 1 } : { height, minWidth: 0, maxWidth: "100%" }}>
      <View pointerEvents={fullscreen ? "auto" : "none"} style={{ flex: 1 }}>
        <WebView
          source={source}
          style={{ flex: 1, backgroundColor: "transparent" }}
          containerStyle={{ minWidth: 0, maxWidth: "100%" }}
          originWhitelist={["*"]}
          onShouldStartLoadWithRequest={({ url }) => isPreviewNavigationAllowed(url)}
          onOpenWindow={() => {}}
          onMessage={onMessage}
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
          setBuiltInZoomControls={fullscreen}
          setDisplayZoomControls={false}
          textZoom={100}
          scrollEnabled={fullscreen}
          nestedScrollEnabled={false}
          bounces={false}
          onError={() => onError(t("rich.failed"))}
          onRenderProcessGone={() => onError(t("rich.failed"))}
          onContentProcessDidTerminate={() => onError(t("rich.failed"))}
        />
      </View>
      {loading ? (
        <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
          <ActivityIndicator accessibilityLabel={t("rich.loading")} />
        </View>
      ) : null}
      {!fullscreen ? (
        <Pressable
          className="absolute inset-0"
          accessibilityRole="button"
          accessibilityLabel={t("rich.fullscreen")}
          onPress={(event) => { event.stopPropagation(); onExpand(); }}
        />
      ) : null}
    </View>
  );
}
