import type { Attachment } from "@multica/core/types";
import { router } from "expo-router";
import { Alert, Linking, Platform } from "react-native";
import { api } from "./api";
import { currentSessionEpoch, sessionEpochChanged } from "./session-epoch";
import { getCurrentSlug } from "./workspace-store";
import { attachmentSource, selectedAttachmentId } from "@/lib/attachment-source";
import { resolveAttachmentUrl } from "@/lib/attachment-url";
import { i18n } from "@/lib/i18n/singleton";

/** Exchange a stable attachment ID for a new signed URL/proxy capability. */
export async function freshAttachmentUrl(source: string, download = false, signal?: AbortSignal): Promise<string> {
  const epoch = currentSessionEpoch();
  const uri = attachmentSource(source);
  const id = selectedAttachmentId(uri);
  if (!id) return uri;
  const attachment = await api.getAttachmentForDownload(id, { signal });
  if (sessionEpochChanged(epoch)) throw new Error("Server session changed");
  return attachmentMediaUrl(attachment, download);
}

function attachmentMediaUrl(attachment: Attachment, download: boolean): string {
  const url = download
    ? attachment.attachment_download_url || attachment.download_url
    : attachment.download_url;
  if (!url) throw new Error("Attachment download URL missing");
  return resolveAttachmentUrl(url)!;
}

export function attachmentPreviewFormat({ filename, content_type }: Attachment) {
  const mimeType = content_type.split(";", 1)[0]?.trim().toLowerCase();
  if (mimeType === "text/markdown" || /\.(md|markdown)$/i.test(filename)) return "markdown";
  if (mimeType === "text/html" || /\.html?$/i.test(filename)) return "html";
}

export async function openAttachment(source: string, options?: { downloadOnly?: boolean }): Promise<void> {
  const epoch = currentSessionEpoch();
  try {
    const uri = attachmentSource(source);
    const id = selectedAttachmentId(uri);
    if (!id) {
      await Linking.openURL(uri);
      return;
    }

    const workspace = getCurrentSlug();
    const attachment = await api.getAttachmentForDownload(id);
    if (sessionEpochChanged(epoch) || workspace !== getCurrentSlug()) return;
    if (Platform.OS === "android" && workspace && !options?.downloadOnly) {
      const format = attachmentPreviewFormat(attachment);
      if (format) {
        router.push({
          pathname: "/[workspace]/attachment/[id]",
          params: { workspace, id, format, filename: attachment.filename },
        });
        return;
      }
    }
    await Linking.openURL(attachmentMediaUrl(attachment, true));
  } catch {
    if (!sessionEpochChanged(epoch)) {
      Alert.alert(i18n.t("settings:server.attachment_failed"));
    }
  }
}
