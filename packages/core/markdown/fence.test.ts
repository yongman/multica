// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isClosedFence, parseFenceTitle } from "./fence";

describe("rich fence metadata and closedness", () => {
  it.each([
    ["```html\n<div>done</div>\n```", true],
    ["~~~mermaid\r\ngraph TD\r\n~~~\r\n", true],
    ["````html\n```\n`````", true],
    ["```html\n<div>streaming", false],
    ["```html", false],
    ["````html\n```", false],
    ["```html\n~~~", false],
    ["```html\n```~", false],
    ["```html\n``` trailing text", false],
    ["    <div>indented</div>", false],
  ])("judges %j from lexer source", (raw, closed) => {
    expect(isClosedFence(raw)).toBe(closed);
  });

  it.each([
    ['html title="Weekly p95" theme=dark', "Weekly p95"],
    ["mermaid title='Sign-up funnel'", "Sign-up funnel"],
    ["title=Funnel", "Funnel"],
    ['subtitle="ignored"', null],
    ['title="  "', null],
    [undefined, null],
  ])("reads title from %j", (meta, title) => {
    expect(parseFenceTitle(meta)).toBe(title);
  });
});
