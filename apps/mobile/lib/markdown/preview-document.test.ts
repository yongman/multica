// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildPreviewDocument, isPreviewNavigationAllowed, readPreviewMessage } from "./preview-document";
import { previewTheme } from "./preview-theme";

const theme = { dark: true, tokens: { "--background": "#111", "--foreground": "#eee", "--chart-1": "#38f" } };

describe("untrusted preview bridge", () => {
  it.each([
    "", "null", "[]", "not json", "{}",
    '{"type":"height","height":100}',
    '{"__multicaMobilePreview":1,"type":"height","height":"100"}',
    '{"__multicaMobilePreview":1,"type":"height","height":1e400}',
    '{"__multicaMobilePreview":1,"type":"open","url":"file:///private"}',
    "x".repeat(2049),
  ])("ignores invalid or privileged messages %j", (message) => {
    expect(readPreviewMessage(message)).toBeNull();
  });

  it.each([[0, 72], [-100, 72], [120.2, 121], [1e20, 360]])("clamps height %s to %s", (height, expected) => {
    expect(readPreviewMessage(JSON.stringify({ __multicaMobilePreview: 1, type: "height", height }))).toEqual({ type: "height", height: expected });
  });

  it("bounds error text without interpreting markup", () => {
    expect(readPreviewMessage(JSON.stringify({ __multicaMobilePreview: 1, type: "error", message: "<script>" + "x".repeat(800) }))).toEqual({
      type: "error", message: ("<script>" + "x".repeat(800)).slice(0, 500),
    });
  });

  it.each(["https://example.com", "http://localhost", "file:///private", "content://contacts", "intent://app", "javascript:alert(1)", "data:text/html,hi", "about:blank.evil"])("blocks navigation to %s", (url) => {
    expect(isPreviewNavigationAllowed(url)).toBe(false);
  });

  it.each(["about:blank", "about:srcdoc", "about:blank#section", "about:srcdoc#section"])("permits document/fragment navigation %s", (url) => {
    expect(isPreviewNavigationAllowed(url)).toBe(true);
  });
});

describe("preview document isolation and theme", () => {
  it("keeps author markup out of the bridge's HTML parser", () => {
    const code = '</script><script>parent.secret = true</script><iframe src="file:///private"></iframe>';
    const document = buildPreviewDocument({ code, kind: "html", theme });
    expect(document).not.toContain(code);
    expect(document).toContain('sandbox="allow-scripts"');
    expect(document).not.toContain("allow-same-origin");
    expect(document).toContain("event.source !== frame.contentWindow");
    expect(document).toContain("connect-src 'none'");
    expect(document).toContain("form-action 'none'");
    // One trusted script in the host; all author tags are string data.
    expect(document.match(/<script>/g)).toHaveLength(1);
    expect(document.match(/<\/script>/g)).toHaveLength(1);
  });

  it("blocks every network resource in both host and sandbox policies", () => {
    const document = buildPreviewDocument({
      code: '<img src="https://tracker.example/read"><script src="https://tracker.example/chart.js"></script>',
      kind: "html", theme,
    });
    const policies = [...document.matchAll(/default-src 'none';[^"<]*/g)].map((match) => match[0]);
    expect(policies).toHaveLength(2);
    for (const policy of policies) {
      expect(policy).not.toMatch(/https:|http:|\*/);
      expect(policy).toContain("script-src 'unsafe-inline'");
      expect(policy).toContain("img-src data:");
      expect(policy).toContain("connect-src 'none'");
      expect(policy).toContain("webrtc 'block'");
    }
  });

  it("supplies safe theme tokens and preserves authored light pages", () => {
    const themed = buildPreviewDocument({ code: "<style>body{color:var(--foreground)}</style>", kind: "html", theme });
    const light = buildPreviewDocument({ code: "<p>Light</p>", kind: "html", theme });
    expect(themed).toContain("color-scheme:dark");
    expect(light).toContain("color-scheme:light");
    expect(themed).toContain("--chart-1:#38f");
    expect(buildPreviewDocument({ code: "", kind: "html", theme: { ...theme, tokens: { "--bad": "</style><script>evil</script>" } } })).not.toContain("--bad:");
  });

  it("maps mobile palette names onto the web embed CSS contract", () => {
    const mapped = previewTheme({
      background: "#111", foreground: "#eee", chart1: "#38f", surface1: "#222",
    } as Parameters<typeof previewTheme>[0], true);
    expect(mapped.tokens).toMatchObject({ "--chart-1": "#38f", "--surface": "#222", "--foreground": "#eee", "--color-scheme": "dark" });
  });
});
