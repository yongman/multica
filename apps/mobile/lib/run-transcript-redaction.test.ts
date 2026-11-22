// @vitest-environment node
import { describe, expect, it } from "vitest";
import { redactRunText, scanShellWords } from "./run-transcript-redaction";
import { embeddedHeaderCases } from "./__tests__/embedded-header-cases";

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

describe("embedded shell commands", () => {
  it.each(embeddedHeaderCases)("masks $name without rewriting outer syntax or safe arguments", ({ command, safe }) => {
    expect(redactRunText(command)).toBe(safe);
    expect(redactRunText(safe)).toBe(safe);
    expect(scanShellWords(safe).every((word) => word.closed)).toBe(true);
  });

  it.each([
    ["'", "'"], ["'", '"'], ["'", ""],
    ['"', "'"], ['"', '"'], ['"', ""],
    ["", "'"], ["", '"'], ["", ""],
  ] as const)("maps source spans across adjacent %s/%s fragments and escape contexts", (leftQuote, rightQuote) => {
    const inner = `curl -H "Authorization: Basic opaque-basic" -H "Accept: application/json" --verbose https://example.test`;
    const safe = `curl -H "Authorization: [REDACTED]" -H "Accept: application/json" --verbose https://example.test`;
    // Split the outer operand at every source boundary, not just the header's.
    const encode = (value: string, quote: string) => quote === "'" ? `'${value.replaceAll("'", "'\\''")}'`
      : quote === '"' ? `"${value.replace(/["\\$`]/g, "\\$&")}"`
      : value.replace(/([^a-zA-Z0-9_/:=.,+-])/g, "\\$1");
    for (let split = 0; split <= inner.length; split++) {
      const raw = `sh -c ${encode(inner.slice(0, split), leftQuote)}${encode(inner.slice(split), rightQuote)} -- outer`;
      const redacted = redactRunText(raw);
      expect(redacted).not.toContain("opaque-basic");
      expect(scanShellWords(redacted).map((word) => word.value)).toEqual(["sh", "-c", safe, "--", "outer"]);
      expect(scanShellWords(redacted).every((word) => word.closed)).toBe(true);
      expect(redactRunText(redacted)).toBe(redacted);
    }
  });

  it.each(["\n", "\r\n"])("keeps embedded continuations %j and multiline credentials within their header", (newline) => {
    const raw = `bash -lc 'curl -H "Auth\\${newline}orization: Digest${newline} response=opaque-response" -H "Accept: application/json" --verbose https://example.test'`;
    const safe = `bash -lc 'curl -H "Authorization: [REDACTED]" -H "Accept: application/json" --verbose https://example.test'`;
    expect(redactRunText(raw)).toBe(safe);
    expect(redactRunText(safe)).toBe(safe);
  });

  it("preserves expansions and literal metacharacters outside the masked source interval", () => {
    const raw = String.raw`sh -c "curl -H 'Authorization: Basic opaque-basic' -H \"Accept: application/json\" --data '\$variable\`literal\`\\path' $URL"`;
    const safe = String.raw`sh -c "curl -H 'Authorization: [REDACTED]' -H \"Accept: application/json\" --data '\$variable\`literal\`\\path' $URL"`;
    expect(redactRunText(raw)).toBe(safe);
    expect(redactRunText(safe)).toBe(safe);
  });

  it("also inspects operands encoded with escaped spaces instead of outer quotes", () => {
    const raw = String.raw`sh -c curl\ -H\ \"Cookie:\ session=opaque-cookie\"\ --verbose\ https://example.test`;
    const redacted = redactRunText(raw);
    expect(redacted).not.toContain("opaque-cookie");
    expect(scanShellWords(redacted).map((word) => word.value))
      .toEqual(["sh", "-c", 'curl -H "Cookie: [REDACTED]" --verbose https://example.test']);
    expect(redactRunText(redacted)).toBe(redacted);
  });

  it.each([
    [`sh -c 'curl -H Cookie:' -- outer`, `sh -c 'curl -H Cookie:[REDACTED]' -- outer`],
    [`sh -c "curl -H 'Authorization: Basic opaque-partial`, `sh -c "curl -H 'Authorization: [REDACTED]`],
  ])("handles empty values and incomplete streamed quoting: %s", (raw, safe) => {
    expect(redactRunText(raw)).toBe(safe);
    expect(redactRunText(safe)).toBe(safe);
  });

  it("fails closed at the recursion limit and remains stable on later display passes", () => {
    let command = `curl -H "Authorization: Basic opaque-deep" --verbose https://example.test`;
    for (let depth = 0; depth < 12; depth++) {
      command = `sh -c "${command.replace(/["\\$`]/g, "\\$&")}" -- outer`;
    }
    const redacted = redactRunText(command);
    expect(redacted).not.toContain("opaque-deep");
    expect(redacted).toContain("[REDACTED]");
    expect(redacted).toMatch(/ -- outer$/);
    expect(scanShellWords(redacted).every((word) => word.closed)).toBe(true);
    expect(redactRunText(redacted)).toBe(redacted);
  });
});
