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
