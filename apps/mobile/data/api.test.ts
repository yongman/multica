// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";

// api.ts refuses to load without a base URL; set it before the import runs.
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = "https://api.example.test";
});

// The real store pulls in expo-secure-store; the client only needs the slug.
vi.mock("@/data/workspace-store", () => ({ getCurrentSlug: () => null }));
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  Networking: { clearCookies: (done: (cleared: boolean) => void) => done(false) },
}));
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "0.1.1" } } }));
vi.mock("expo-secure-store", () => ({ getItemAsync: async () => null }));

describe("api.listAgents", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    [undefined, "/api/agents"],
    [{ includeArchived: false }, "/api/agents"],
    [{ includeArchived: true }, "/api/agents?include_archived=true"],
  ])("with %j requests %s", async (opts, path) => {
    const fetchMock = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.listAgents(opts)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `https://api.example.test${path}`,
      expect.objectContaining({
        credentials: "omit",
        headers: expect.objectContaining({ "X-Client-OS": "android", "X-Client-Version": "0.1.1" }),
      }),
    );
  });
});

describe("api.listChildIssues", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([{}, { issues: null }, { issues: [{ id: 123 }] }])("handles missing or malformed children in %j", async (body) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(body)));
    await expect(api.listChildIssues("parent-1")).resolves.toEqual({ issues: [] });
  });

  it("uses the dedicated endpoint with cancellation and propagates load failures", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => Response.json({ error: "Unavailable" }, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.listChildIssues("parent-1", { signal: controller.signal })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/issues/parent-1/children",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

describe("api.quickCreateIssue", () => {
  afterEach(() => vi.unstubAllGlobals());

  const request = { agent_id: "agent-1", prompt: "Add an Android smoke test" };

  it.each([undefined, "project-1"])("sends the quick-create request with project %s", async (projectId) => {
    const fetchMock = vi.fn(async () => Response.json({}, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const body = { ...request, project_id: projectId };
    await expect(api.quickCreateIssue(body)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "https://api.example.test/api/issues/quick-create",
      expect.objectContaining({ method: "POST", body: JSON.stringify(body) }),
    );
  });

  it("preserves the server's rejection reason", async () => {
    const body = { code: "agent_unavailable", reason: "Runtime is offline" };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(body, { status: 422 })));

    await expect(api.quickCreateIssue(request)).rejects.toMatchObject({ status: 422, body });
  });

  it("sends a squad to quick-create without substituting its leader as agent_id", async () => {
    const fetchMock = vi.fn(async () => Response.json({ task_id: "run-1" }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const body = { squad_id: "squad-1", prompt: "Ship the feature", project_id: "project-1" };
    await expect(api.quickCreateIssue(body)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "https://api.example.test/api/issues/quick-create",
      expect.objectContaining({ method: "POST", body: JSON.stringify(body) }),
    );
  });

  it.each([
    [403, { error: "you do not have permission to assign work to this squad" }],
    [400, { error: "squad is archived" }],
    [422, { code: "daemon_version_unsupported", reason: "Update the runtime" }],
  ])("keeps the squad rejection payload for status %s", async (status, body) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(body, { status })));
    await expect(api.quickCreateIssue({ squad_id: "squad-1", prompt: "Ship it" }))
      .rejects.toMatchObject({ status, body });
  });
});

describe("api.deleteComment", () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // #8296: servers that keep a deleted comment's replies also route
  // /keep-replies; older servers do not, so a keep-replies delete that reaches
  // one fails instead of deleting the replies too.
  it.each([
    [{ keepReplies: true }, "https://api.example.test/api/comments/comment-1/keep-replies"],
    [{ keepReplies: false }, "https://api.example.test/api/comments/comment-1"],
    [undefined, "https://api.example.test/api/comments/comment-1"],
  ])("with %j sends DELETE %s", async (opts, url) => {
    await api.deleteComment("comment-1", opts);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({ method: "DELETE" }));
  });
});


describe("api.listIssues requester compatibility", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([false, true])("checks server support before returning Created rows (supported=%s)", async (supported) => {
    const fetchMock = vi.fn(async (_url: string) => Response.json({ issues: [], total: 0, ...(supported ? { created_by_user_id: "me" } : {}) }));
    vi.stubGlobal("fetch", fetchMock);
    await api.listIssues({ created_by_user_id: "me" });
    expect(fetchMock).toHaveBeenCalledTimes(supported ? 1 : 2);
    if (!supported) expect(String(fetchMock.mock.calls[1]?.[0])).toContain("creator_id=me");
  });
  it("sends page ordering using the server's sort and direction parameters", async () => {
    const fetchMock = vi.fn(async (_url: string) => Response.json({ issues: [], total: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    await api.listIssues({ limit: 100, offset: 200, sort_by: "created_at", sort_direction: "asc" });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: "100", offset: "200", sort: "created_at", direction: "asc",
    });
  });
});

describe("api.sendChatMessage steering", () => {
  const accepted = {
    message_id: "message-1",
    task_id: "task-1",
    created_at: "2026-11-16T00:00:00Z",
  };

  afterEach(() => vi.unstubAllGlobals());

  // The server decides whether a send can join the running reply; the client
  // only states intent. Default sends ask to steer, the explicit queue does not.
  it.each([
    [undefined, true],
    [{ attachmentIds: ["attachment-1"] }, true],
    [{ queue: false }, true],
    [{ queue: true }, false],
  ])("with %j sends steer=%s", async (opts, steer) => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json(accepted, { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.sendChatMessage("session-1", "use the new path", opts);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.steer).toBe(steer);
    expect(body.content).toBe("use the new path");
  });
});

describe("native attachment metadata", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("falls back to the validated inline URL when the optional download-intent field drifts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      id: "attachment-1", filename: "report.txt", url: "/uploads/report.txt",
      download_url: "/api/attachments/attachment-1/signed-download?sig=s",
      attachment_download_url: 123,
    })));
    const metadata = await api.getAttachmentForDownload("attachment-1");
    expect(metadata.attachment_download_url).toBe("");
    expect(metadata.download_url).toBe("/api/attachments/attachment-1/signed-download?sig=s");
  });
});

describe("native attachment preview content", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads a text body from the workspace-scoped endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response("# Preview"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.getAttachmentTextContent("attachment-1", "test-workspace")).resolves.toBe("# Preview");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "https://api.example.test/api/attachments/attachment-1/content",
      expect.objectContaining({
        credentials: "omit",
        headers: expect.objectContaining({ "X-Workspace-Slug": "test-workspace" }),
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
