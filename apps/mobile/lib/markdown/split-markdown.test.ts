// @vitest-environment node
import { describe, expect, it } from "vitest";
import { splitMarkdown } from "./split-markdown";
import { preprocessMobileMarkdown } from "./preprocess";

const longLine = "0123456789".repeat(100);

describe("overflow-prone Markdown segment routing", () => {
  it.each([
    ["fenced", `\`\`\`text\n${longLine}\n\`\`\``],
    ["indented", `    ${longLine}`],
  ])("routes %s code to horizontal scrolling with every character preserved", (_name, input) => {
    expect(splitMarkdown(input)).toEqual([{ type: "code", lang: _name === "fenced" ? "text" : undefined, code: longLine }]);
  });

  it.each([
    `- Parent\n\n    \`\`\`text\n    ${longLine}\n    \`\`\``,
    `> \`\`\`text\n> ${longLine}\n> \`\`\``,
    `> - [ ] Parent\n>   - \`${longLine}\``,
  ])("preserves nested block structure for the native wrapping fallback", (content) => {
    expect(splitMarkdown(content)).toEqual([{ type: "prose", content }]);
  });

  it("strips HTML layout dimensions while preserving long text and image sources", () => {
    const content = `<div style="width:9999px">${longLine}</div>\n\n<img src="https://example.com/wide.png" width="9999" height="10">`;
    expect(splitMarkdown(preprocessMobileMarkdown(content))).toEqual([
      { type: "prose", content: longLine },
      { type: "image", uri: "https://example.com/wide.png", alt: "" },
    ]);
  });
});

describe("rich preview routing", () => {
  it.each(["html", "mermaid"] as const)("upgrades closed %s with title while preserving source", (kind) => {
    const code = kind === "html" ? "<svg><text>中文</text></svg>" : "graph TD\nA --> B";
    expect(splitMarkdown(`Before\n\n\`\`\`${kind} title="Example"\n${code}\n\`\`\`\n\nAfter`)).toEqual([
      { type: "prose", content: "Before" },
      { type: "preview", kind, title: "Example", code },
      { type: "prose", content: "After" },
    ]);
  });

  it.each(["htmlbars", "mermaidx", "svg", "HTML", "math", "chart"])("leaves %s as source, matching web dispatch", (lang) => {
    expect(splitMarkdown(`\`\`\`${lang}\nsource\n\`\`\``)).toEqual([
      { type: "code", lang, code: "source" },
    ]);
  });

  it("waits for a matching closer while streaming", () => {
    const open = "````mermaid title='Diagram'\ngraph TD\nA --> B\n```";
    expect(splitMarkdown(open)[0]?.type).toBe("code");
    expect(splitMarkdown(open + "\n````")[0]).toMatchObject({ type: "preview", title: "Diagram" });
  });

  it("preserves complete HTML and Markdown-looking strings inside rich sources", () => {
    const code = '<!doctype html>\n<script>const text = `\n- [x] original\n!file[file](https://example.com/file)\n[@ id="member" label="original"]\n`;</script>';
    const content = `Before<br>after\n\n~~~html title='Document'\n${code}\n~~~\n\n- [x] done`;
    const processed = preprocessMobileMarkdown(content);
    expect(processed).toContain(code);
    expect(processed).toContain("Before  \nafter");
    expect(processed).toContain("- [x] ~~done~~");
    expect(splitMarkdown(processed)[1]).toEqual({ type: "preview", kind: "html", title: "Document", code });
  });

  it("does not execute bare HTML or rich fences nested in lists and quotes", () => {
    for (const content of [
      "<!doctype html><html><body>Text<script>alert(1)</script></body></html>",
      "> ```html\n> <b>Text</b>\n> ```",
      "- Item\n\n  ```mermaid\n  graph TD\n  ```",
    ]) {
      expect(splitMarkdown(preprocessMobileMarkdown(content)).every((segment) => segment.type !== "preview")).toBe(true);
    }
  });
});
