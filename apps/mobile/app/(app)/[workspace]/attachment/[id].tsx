import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { attachmentDownloadPath } from "@multica/core/types/attachment-url";
import { IconButton } from "@/components/ui/icon-button";
import { Text } from "@/components/ui/text";
import { api } from "@/data/api";
import { openAttachment } from "@/data/attachment-media";
import { useT } from "@/lib/i18n";
import { Markdown } from "@/lib/markdown";

const HTML_PREVIEW_HEAD = `<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'">`;

export default function AttachmentPreview() {
  const { workspace, id, filename, format } = useLocalSearchParams<{
    workspace: string;
    id: string;
    filename?: string;
    format?: string;
  }>();
  const { t } = useT();
  const canPreview = format === "html" || format === "markdown";
  const preview = useQuery({
    queryKey: ["attachment-text-preview", workspace, id],
    queryFn: ({ signal }) => api.getAttachmentTextContent(id, workspace, signal),
    enabled: canPreview,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const error = (
    <View className="flex-1 items-center justify-center px-6">
      <Text className="text-center text-muted-foreground">{t("editor:preview.failed")}</Text>
    </View>
  );

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen
        options={{
          title: filename || t("editor:preview.title"),
          headerRight: () => (
            <IconButton
              name="download-outline"
              accessibilityLabel={t("common:actions.download")}
              onPress={() => void openAttachment(attachmentDownloadPath(id), { downloadOnly: true })}
            />
          ),
        }}
      />
      {preview.isPending && canPreview ? (
        <ActivityIndicator style={{ flex: 1 }} accessibilityLabel={t("common:states.loading")} />
      ) : preview.data === undefined ? (
        error
      ) : format === "markdown" ? (
        <ScrollView contentContainerClassName="p-4">
          <Markdown content={preview.data} />
        </ScrollView>
      ) : (
        <WebView
          source={{ html: HTML_PREVIEW_HEAD + preview.data }}
          originWhitelist={["*"]}
          onShouldStartLoadWithRequest={({ url }) => url === "about:blank"}
          javaScriptEnabled={false}
          domStorageEnabled={false}
          allowFileAccess={false}
          setSupportMultipleWindows={false}
          renderError={() => error}
        />
      )}
    </SafeAreaView>
  );
}
