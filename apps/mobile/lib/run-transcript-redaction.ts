import { redactSecrets } from "@multica/core/security/redact-secrets";

type ShellQuote = "" | "'" | '"';

export interface ShellWord {
  start: number;
  end: number;
  value: string;
  quoteStyle: ShellQuote;
  closed: boolean;
  escapedWhitespace: boolean;
}

const SHELL_SEPARATOR = /[ \t\r\n;|&<>()]/;

/** Decode literal shell words and retain their source intervals. Expansions are
 * not evaluated; quotes, escapes and continuations only affect word assembly. */
export function scanShellWords(text: string): ShellWord[] {
  const words: ShellWord[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    if (SHELL_SEPARATOR.test(text[cursor]!)) {
      cursor++;
      continue;
    }
    const start = cursor;
    let value = "";
    let quote: ShellQuote = "";
    let quoteStyle: ShellQuote = "";
    let present = false;
    let escapedWhitespace = false;
    while (cursor < text.length) {
      const char = text[cursor]!;
      const next = text[cursor + 1];
      if (char === "\\" && quote !== "'") {
        if (next === "\n" || (next === "\r" && text[cursor + 2] === "\n")) {
          escapedWhitespace = true;
          cursor += next === "\r" ? 3 : 2;
          continue;
        }
        // In double quotes, backslashes before ordinary characters are literal.
        if (next && (!quote || /["\\$`]/.test(next))) {
          escapedWhitespace ||= /[ \t]/.test(next);
          value += next;
          present = true;
          cursor += 2;
          continue;
        }
      }
      if (quote) {
        if (char === quote) quote = "";
        else value += char;
      } else if (char === "'" || char === '"') {
        quote = char;
        quoteStyle ||= char;
      } else if (SHELL_SEPARATOR.test(char)) {
        break;
      } else {
        value += char;
      }
      present = true;
      cursor++;
    }
    // A continuation followed by whitespace is not an empty argument.
    if (present) {
      words.push({ start, end: cursor, value, quoteStyle, closed: !quote, escapedWhitespace });
    }
  }
  return words;
}

const CREDENTIAL_HEADER =
  "(?:(?:proxy-)?authorization|(?:set-)?cookie|(?:x-)?api-key|x-(?:auth|access)-token)";
const HEADER_PARAMETER = new RegExp(String.raw`^(${CREDENTIAL_HEADER}[ \t]*:)([ \t]*)`, "i");
// Raw header matching is confined to the independent HTTP-line path.
const HTTP_HEADER_LINES = new RegExp(String.raw`^([ \t]*)(${CREDENTIAL_HEADER}[ \t]*:[ \t]*)[^\r\n]*`, "gim");

interface Mask {
  kind: "shell" | "http";
  start: number;
  end: number;
  replacement: string;
}

function lineEnd(text: string, start: number): number {
  let end = start;
  while (end < text.length && text[end] !== "\r" && text[end] !== "\n") end++;
  return end;
}

function bareHttpHeader(text: string, word: ShellWord, headerLabel: string, explicitHeader: boolean): Mask | null {
  if (explicitHeader) return null;
  const prefix = HEADER_PARAMETER.exec(text.slice(word.start));
  if (!prefix) return null;
  const lineStart = Math.max(text.lastIndexOf("\n", word.start - 1), text.lastIndexOf("\r", word.start - 1)) + 1;
  const end = lineEnd(text, word.start);
  const bareLine = !word.escapedWhitespace && word.end <= end && !text.slice(lineStart, word.start).trim();
  const bareValue = text.slice(word.start, word.end) === word.value && word.value === headerLabel;
  // HTTP text includes every value on its physical line, even when cookie
  // quotes or spaces would split it differently under shell syntax.
  return bareLine || bareValue ? {
    kind: "http", start: word.start, end,
    replacement: `${prefix[0]}[REDACTED]`,
  } : null;
}

export function redactRunText(text: string): string {
  const words = scanShellWords(text);
  const masks: Mask[] = [];
  for (const [index, word] of words.entries()) {
    const prefix = word.value.startsWith("--header=") ? "--header="
      : word.value.startsWith("-H") ? "-H" : "";
    const header = HEADER_PARAMETER.exec(word.value.slice(prefix.length));
    if (!header) continue;
    const previous = words[index - 1];
    const explicitHeader = !!prefix || (!!previous &&
      (previous.value === "-H" || previous.value === "--header") &&
      /^[ \t]*(?:\\\r?\n[ \t]*)*$/.test(text.slice(previous.end, word.start)));
    const http = bareHttpHeader(text, word, header[1], explicitHeader);
    if (http) {
      masks.push(http);
      continue;
    }
    const quote = word.quoteStyle;
    masks.push({
      kind: "shell", start: word.start, end: word.end,
      replacement: `${prefix}${quote}${header[1]}${quote ? header[2] : ""}[REDACTED]${word.closed ? quote : ""}`,
    });
  }
  for (const match of text.matchAll(HTTP_HEADER_LINES)) {
    masks.push({
      kind: "http", start: match.index + match[1].length, end: match.index + match[0].length,
      replacement: `${match[2]}[REDACTED]`,
    });
  }
  masks.sort((a, b) => a.start - b.start || Number(a.kind === "http") - Number(b.kind === "http"));
  const merged: Mask[] = [];
  for (const mask of masks) {
    const previous = merged[merged.length - 1];
    if (previous && mask.start < previous.end) {
      // A shell header can span HTTP-looking lines. Its source interval owns
      // those lines, so a bare-line match cannot swallow later CLI arguments.
      if (previous.kind === "http") previous.end = Math.max(previous.end, mask.end);
    } else {
      merged.push({ ...mask });
    }
  }
  let result = "";
  let offset = 0;
  for (const mask of merged) {
    // Generic TOKEN patterns must not consume a masked header's name or quotes.
    result += redactSecrets(text.slice(offset, mask.start)) + mask.replacement;
    offset = mask.end;
  }
  return result + redactSecrets(text.slice(offset));
}
