// @vitest-environment node
import { describe, expect, it } from "vitest";
import { redactRunText, scanShellWords } from "./run-transcript-redaction";

describe("shell word decoding", () => {
  it.each([
    [`'Authorization'': Basic opaque'`, "Authorization: Basic opaque"],
    [`"Auth""orization: Basic opaque"`, "Authorization: Basic opaque"],
    [`Auth\\orization\\:\\ Basic\\ opaque`, "Authorization: Basic opaque"],
    [`Authorization\\\n:\\ Basic\\ opaque`, "Authorization: Basic opaque"],
    [`"Auth\\\r\norization: Basic opaque"`, "Authorization: Basic opaque"],
    [`'literal\\\nbackslash'`, "literal\\\nbackslash"],
    [`"literal\\q\\ space"`, "literal\\q\\ space"],
    [`"escaped\\\"quote\\$and\\\`"`, 'escaped"quote$and`'],
    [`opaque\u00a0credential`, "opaque\u00a0credential"],
    [`''`, ""],
  ])("records the decoded word and its exact source interval: %s", (raw, decoded) => {
    const text = `curl -H ${raw} --verbose`;
    const words = scanShellWords(text);
    expect(words.map((word) => word.value)).toEqual(["curl", "-H", decoded, "--verbose"]);
    expect(words.map((word) => text.slice(word.start, word.end))).toEqual(["curl", "-H", raw, "--verbose"]);
    expect(words[2].start).toBe(8);
    expect(words[2].end).toBe(8 + raw.length);
    expect(words[2].closed).toBe(true);
  });

  it("drops bare continuations while retaining empty quoted arguments and operators", () => {
    const text = "curl \\\n \\\r\n -H '' && echo done";
    expect(scanShellWords(text).map((word) => word.value)).toEqual(["curl", "-H", "", "echo", "done"]);
  });

  it("keeps an incomplete quoted header masked through the end of its source", () => {
    const text = `curl -H "Auth""orization: Digest\n response=opaque`;
    expect(scanShellWords(text).at(-1)).toMatchObject({ value: "Authorization: Digest\n response=opaque", closed: false });
    expect(redactRunText(text)).toBe(`curl -H "Authorization: [REDACTED]`);
  });
});

describe("HTTP and shell header isolation", () => {
  it.each([
    "Authorization", "Proxy-Authorization", "Cookie", "Set-Cookie",
    "X-API-Key", "X-Auth-Token", "X-Access-Token",
  ])("recognizes every literal shell split boundary in %s, including before its colon", (name) => {
    const tail = ` -H "Ac""cept: application/json" --verbose`;
    for (let index = 0; index <= name.length; index++) {
      const left = name.slice(0, index);
      const right = name.slice(index);
      const variants = [
        [`"${left}""${right}: opaque-secret"`, `"${name}: [REDACTED]"`],
        [`'${left}''${right}: opaque-secret'`, `'${name}: [REDACTED]'`],
        [`${left}\\${right}:\\ opaque-secret`, `${name}:[REDACTED]`],
        [`${left}\\\n${right}:\\ opaque-secret`, `${name}:[REDACTED]`],
        [`${left}\\\r\n${right}:\\ opaque-secret`, `${name}:[REDACTED]`],
        [`"${left}\\\n${right}: opaque-secret"`, `"${name}: [REDACTED]"`],
        [`"${left}\\\r\n${right}: opaque-secret"`, `"${name}: [REDACTED]"`],
      ];
      for (const [raw, safe] of variants) {
        for (const prefix of ["-H ", "-H", "--header=", ""]) {
          expect(redactRunText(`curl ${prefix}${raw}${tail}`)).toBe(`curl ${prefix}${safe}${tail}`);
        }
      }
    }
  });

  it("retains subsequent bare HTTP lines even when a cookie contains an unmatched quote", () => {
    const text = 'Cookie: session="opaque\nX-API-Key: opaque-api\nAccept: application/json';
    expect(redactRunText(text)).toBe("Cookie: [REDACTED]\nX-API-Key: [REDACTED]\nAccept: application/json");
  });

  it("lets a complete shell word own HTTP-looking lines inside its value", () => {
    const text = `curl -H "Auth""orization: Digest\nCookie: opaque-cookie" -H "Ac""cept: application/json" --verbose`;
    expect(redactRunText(text)).toBe(`curl -H "Authorization: [REDACTED]" -H "Ac""cept: application/json" --verbose`);
  });

  it("keeps a standalone multiline shell word distinct from a bare HTTP line", () => {
    const text = `curl \\\n Authorization:'Digest\n response=opaque' -H "Ac""cept: application/json" --verbose`;
    expect(redactRunText(text)).toBe(`curl \\\n 'Authorization:[REDACTED]' -H "Ac""cept: application/json" --verbose`);
  });

  it("does not normalize non-sensitive shell parameters", () => {
    const text = `curl -H "X-Custom-Auth""orization: public" -H Ac\\cept:\\ application/json --verbose`;
    expect(redactRunText(text)).toBe(text);
  });
});
