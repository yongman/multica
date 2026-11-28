export interface PreviewWebViewProps {
  document: string;
  fullscreen: boolean;
  onMessage: (data: string) => void;
  onFailure: (reason: "unsupported" | "failed") => void;
}
