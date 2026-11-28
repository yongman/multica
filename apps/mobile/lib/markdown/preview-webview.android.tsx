import type { ViewProps, NativeSyntheticEvent } from "react-native";
import { requireNativeView } from "expo";
import type { PreviewWebViewProps } from "./preview-webview.types";

interface NativeProps extends ViewProps {
  document: string;
  fullscreen: boolean;
  onMessage: (event: NativeSyntheticEvent<{ data: string }>) => void;
  onFailure: (event: NativeSyntheticEvent<{ reason: "unsupported" | "failed" }>) => void;
}

const NativePreview = requireNativeView<NativeProps>("MarkdownPreview");

export function PreviewWebView({ document, fullscreen, onMessage, onFailure }: PreviewWebViewProps) {
  return (
    <NativePreview
      document={document}
      fullscreen={fullscreen}
      style={{ flex: 1, minWidth: 0, maxWidth: "100%" }}
      onMessage={({ nativeEvent }) => onMessage(nativeEvent.data)}
      onFailure={({ nativeEvent }) => onFailure(nativeEvent.reason)}
    />
  );
}
