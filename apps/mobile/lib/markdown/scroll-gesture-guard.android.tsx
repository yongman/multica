import type { PropsWithChildren } from "react";
import type { ViewProps } from "react-native";
import { requireNativeView } from "expo";

const NativeGuard = requireNativeView<ViewProps>("MarkdownScrollGuard");

/** Keep the first diagonal MOVE available to the code ScrollView. */
export function ScrollGestureGuard({ children }: PropsWithChildren) {
  return (
    <NativeGuard collapsable={false} style={{ flexGrow: 0, minWidth: 0, maxWidth: "100%" }}>
      {children}
    </NativeGuard>
  );
}
