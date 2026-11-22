import { redactSecrets } from "@multica/core/security/redact-secrets";

type ShellQuote = "" | "'" | '"';

interface ShellCharacter {
  start: number;
  end: number;
  quote: ShellQuote;
}

export interface ShellWord {
  start: number;
  end: number;
  value: string;
  quoteStyle: ShellQuote;
  closed: boolean;
  escapedWhitespace: boolean;
  /** One source span per decoded UTF-16 unit, including its escaping context. */
  characters: ShellCharacter[];
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
    const characters: ShellCharacter[] = [];
    const append = (char: string, start: number, end: number) => {
      value += char;
      characters.push({ start, end, quote });
    };
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
          append(next, cursor, cursor + 2);
          present = true;
          cursor += 2;
          continue;
        }
      }
      if (quote) {
        if (char === quote) quote = "";
        else append(char, cursor, cursor + 1);
      } else if (char === "'" || char === '"') {
        quote = char;
        quoteStyle ||= char;
      } else if (SHELL_SEPARATOR.test(char)) {
        break;
      } else {
        append(char, cursor, cursor + 1);
      }
      present = true;
      cursor++;
    }
    // A continuation followed by whitespace is not an empty argument.
    if (present) {
      words.push({ start, end: cursor, value, quoteStyle, closed: !quote, escapedWhitespace, characters });
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

const MAX_EMBEDDED_SHELL_DEPTH = 4;

/** Encode only replacement text in the surrounding operand's quote context.
 * Unchanged source (including expansions and outer quotes) stays verbatim. */
function shellFragment(text: string, quote: ShellQuote): string {
  if (quote === "'") return text.replaceAll("'", "'\\''");
  if (quote === '"') return text.replace(/["\\$`]/g, "\\$&");
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function embeddedMasks(text: string, word: ShellWord, depth: number): Mask[] {
  // Decoding must make progress. This includes quoted operands and escaped
  // spaces, so sh/bash/zsh -c strings need no command-name heuristics.
  if (word.value === text.slice(word.start, word.end)) return [];
  if (depth >= MAX_EMBEDDED_SHELL_DEPTH) {
    // Fail closed rather than displaying an operand hidden behind more layers.
    const quote = word.quoteStyle || "'";
    return [{
      kind: "shell", start: word.start, end: word.end,
      replacement: `${quote}[REDACTED]${word.closed ? quote : ""}`,
    }];
  }
  return headerMasks(word.value, depth + 1).map((mask) => {
    const start = word.characters[mask.start]!.start;
    const end = word.characters[mask.end - 1]!.end;
    const original = word.value.slice(mask.start, mask.end);
    let left = 0;
    let right = 0;
    while (left < original.length && left < mask.replacement.length &&
      original[left] === mask.replacement[left]) left++;
    while (right < original.length - left && right < mask.replacement.length - left &&
      original[original.length - right - 1] === mask.replacement[mask.replacement.length - right - 1]) right++;
    if (original === mask.replacement) {
      return { kind: "shell", start, end, replacement: text.slice(start, end) };
    }
    // For an insertion (e.g. a streamed empty "Cookie:"), retain a source
    // character as the anchor so the surrounding quote context is defined.
    if (left + right === original.length) {
      if (left) left--;
      else right--;
    }
    // Preserve common source edges, especially escaped quote delimiters. This
    // also makes repeat display passes stable instead of adding empty quotes.
    const first = word.characters[mask.start + left]!;
    const last = word.characters[mask.end - right - 1]!;
    // A mask may cross adjacent outer quote fragments. Balance only the
    // removed transitions, leaving the surrounding fragments intact.
    const transition = first.quote === last.quote ? "" : first.quote + last.quote;
    return {
      kind: "shell", start, end,
      replacement: text.slice(start, first.start) +
        shellFragment(mask.replacement.slice(left, mask.replacement.length - right), first.quote) +
        transition + text.slice(last.end, end),
    };
  });
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

function headerMasks(text: string, depth: number): Mask[] {
  const words = scanShellWords(text);
  const masks: Mask[] = [];
  for (const [index, word] of words.entries()) {
    const prefix = word.value.startsWith("--header=") ? "--header="
      : word.value.startsWith("-H") ? "-H" : "";
    const header = HEADER_PARAMETER.exec(word.value.slice(prefix.length));
    if (!header) {
      masks.push(...embeddedMasks(text, word, depth));
      continue;
    }
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
  return merged;
}

export function redactRunText(text: string): string {
  let result = "";
  let offset = 0;
  for (const mask of headerMasks(text, 0)) {
    // Generic TOKEN patterns must not consume a masked header's name or quotes.
    result += redactSecrets(text.slice(offset, mask.start)) + mask.replacement;
    offset = mask.end;
  }
  return result + redactSecrets(text.slice(offset));
}
