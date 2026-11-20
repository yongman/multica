// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshAttachmentUrl, openAttachment } from "./attachment-media";
import { api } from "./api";
import { useServerConfigStore } from "./server-config-store";
import { invalidateSessionEpoch } from "./session-epoch";
import { attachmentSource } from "@/lib/attachment-source";
import { router } from "expo-router";
import { Linking, Platform } from "react-native";

vi.mock("./api", () => ({ api: { getAttachmentForDownload: vi.fn() } }));
vi.mock("./workspace-store", () => ({ getCurrentSlug: () => "test-workspace" }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  Linking: { openURL: vi.fn() },
  Alert: { alert: vi.fn() },
}));
const id = "123e4567-e89b-12d3-a456-426614174000";
const root = "https://self.test:8443/proxy";
const stable = `${root}/api/attachments/${id}/download`;

beforeEach(() => {
  vi.clearAllMocks();
  Platform.OS = "android";
  useServerConfigStore.setState({ config: { apiUrl: root, webUrl: "https://web.test/ui" } });
});

describe("native private attachment URLs", () => {
  it("gets a fresh proxy capability at each use, including download intent", async () => {
    vi.mocked(api.getAttachmentForDownload).mockResolvedValue({
      id, filename: "report.pdf", content_type: "application/pdf",
      url: stable, download_url: `/api/attachments/${id}/signed-download?exp=60&sig=first`,
      attachment_download_url: `/api/attachments/${id}/signed-download?exp=60&sig=first&dl=1`,
    } as never);
    expect(await freshAttachmentUrl(stable)).toBe(`${root}/api/attachments/${id}/signed-download?exp=60&sig=first`);
    await openAttachment(stable);
    expect(Linking.openURL).toHaveBeenCalledWith(`${root}/api/attachments/${id}/signed-download?exp=60&sig=first&dl=1`);
    expect(router.push).not.toHaveBeenCalled();
    vi.mocked(api.getAttachmentForDownload).mockResolvedValue({
      id, url: stable, download_url: `/api/attachments/${id}/signed-download?exp=120&sig=second`,
    } as never);
    expect(await freshAttachmentUrl(stable)).toContain("sig=second");
    expect(api.getAttachmentForDownload).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["README.MD", "application/octet-stream", "markdown"],
    ["report", "text/html; charset=utf-8", "html"],
  ])("previews %s on Android and keeps explicit downloads available", async (filename, contentType, format) => {
    const download = `${root}/api/attachments/${id}/signed-download?dl=1`;
    vi.mocked(api.getAttachmentForDownload).mockResolvedValue({
      id, filename, content_type: contentType, attachment_download_url: download,
    } as never);

    await openAttachment(stable);
    expect(router.push).toHaveBeenCalledExactlyOnceWith({
      pathname: "/[workspace]/attachment/[id]",
      params: { workspace: "test-workspace", id, filename, format },
    });
    expect(Linking.openURL).not.toHaveBeenCalled();

    await openAttachment(stable, { downloadOnly: true });
    Platform.OS = "ios";
    await openAttachment(stable);
    expect(Linking.openURL).toHaveBeenCalledTimes(2);
    expect(Linking.openURL).toHaveBeenLastCalledWith(download);
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("preserves a signed storage URL and never sends a bearer to an external image host", async () => {
    const signed = "https://storage.test/file?Signature=s";
    vi.mocked(api.getAttachmentForDownload).mockResolvedValue({ id, url: stable, download_url: signed } as never);
    expect(await freshAttachmentUrl(stable)).toBe(signed);
    expect(await freshAttachmentUrl("https://external.test/picture.png")).toBe("https://external.test/picture.png");
    expect(api.getAttachmentForDownload).toHaveBeenCalledTimes(1);
  });

  it("uses record identity for Markdown and refuses a result from a previous instance", async () => {
    expect(attachmentSource(`mc://file/${id}`)).toBe(stable);
    expect(attachmentSource("https://storage.test/file", [{ id, url: "https://storage.test/file" } as never])).toBe(stable);
    let resolve!: (value: never) => void;
    vi.mocked(api.getAttachmentForDownload).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const opening = openAttachment(stable);
    invalidateSessionEpoch();
    useServerConfigStore.setState({ config: { apiUrl: "https://new.test", webUrl: "https://new.test" } });
    resolve({ id, url: stable, download_url: "/api/old-capability" } as never);
    await opening;
    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });
});
