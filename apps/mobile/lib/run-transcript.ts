import type { AgentTask, TaskMessagePayload } from "@multica/core/types";
import { redactSecrets } from "@multica/core/security/redact-secrets";
import { failureReasonKey } from "./failure-reason-label";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const RUN_TRANSCRIPT_PATHNAME =
  "/[workspace]/issue/[id]/run/[taskId]" as const;

export function runTranscriptRoute(
  workspace: string,
  issueId: string,
  taskId: string,
) {
  return {
    pathname: RUN_TRANSCRIPT_PATHNAME,
    params: { workspace, id: issueId, taskId },
  } as const;
}

export function isRunTranscriptTaskId(taskId: unknown): taskId is string {
  return typeof taskId === "string" && UUID_PATTERN.test(taskId);
}

export function isCancellableRunStatus(status: AgentTask["status"]): boolean {
  return (
    status === "queued" ||
    status === "deferred" ||
    status === "dispatched" ||
    status === "waiting_local_directory" ||
    status === "running"
  );
}

const builtRuns = new WeakMap<
  TaskMessagePayload,
  { members: readonly TaskMessagePayload[]; message: TaskMessagePayload }
>();

// Match whole names or suffixes at segment boundaries, so SERVICE_API_KEY is
// sensitive while file_key, token_count and secret_name remain useful.
const CREDENTIAL_FIELDS = new Set([
  "authorization", "proxyauthorization", "cookie", "setcookie",
  "apikey", "xapikey", "apisecret", "secret", "secretkey",
  "token", "accesstoken", "authtoken", "refreshtoken", "idtoken", "xauthtoken", "xaccesstoken",
  "password", "passwd", "dbpassword", "privatekey", "clientsecret",
  "credential", "credentials", "awssecretaccesskey", "secretaccesskey",
  "databaseurl", "dburl", "redisurl",
]);

const SUMMARY_FIELDS = [
  "command", "cmd", "file_path", "path", "pattern",
  "query", "description", "prompt", "skill",
] as const;

function isCredentialField(key: string): boolean {
  const segments = key.toLowerCase().split(/[-_\s]+/);
  return segments.some((_, index) => CREDENTIAL_FIELDS.has(segments.slice(index).join("")));
}

const CREDENTIAL_HEADER =
  "(?:(?:proxy-)?authorization|(?:set-)?cookie|(?:x-)?api-key|x-(?:auth|access)-token)";
const CREDENTIAL_HEADER_TEXT = new RegExp(
  String.raw`(^|[^\w-]|-H)(${CREDENTIAL_HEADER}[ \t]*:)([ \t]*)`,
  "gim",
);

type ShellQuote = "" | "'" | '"';

/** Read one shell word without evaluating it. Physical newlines only end
 * unquoted, unescaped words; adjacent quoted/unquoted segments stay together. */
function scanShellWord(text: string, start: number, initialQuote: ShellQuote) {
  let quote = initialQuote;
  let end = start;
  let escapedWhitespace = false;
  while (end < text.length) {
    const char = text[end]!;
    if (char === "\\" && quote !== "'") {
      const next = text[end + 1];
      escapedWhitespace ||= !!next && /\s/.test(next);
      // Treat CRLF continuations as one escape, just like LF continuations.
      end += next === "\r" && text[end + 2] === "\n" ? 3 : next ? 2 : 1;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (/[\s;|&<>()]/.test(char)) {
      break;
    }
    end++;
  }
  return { end, quote, escapedWhitespace };
}

function redactRunText(text: string): string {
  let result = "";
  let offset = 0;
  for (const match of text.matchAll(CREDENTIAL_HEADER_TEXT)) {
    if (match.index < offset) continue;
    const [, prefix, name, padding] = match;
    const quote: ShellQuote = prefix === "'" || prefix === '"' ? prefix : "";
    const nameStart = match.index + prefix.length;
    const valueStart = nameStart + name.length;
    const word = scanShellWord(text, valueStart, quote);
    const beforeName = text.slice(0, nameStart);
    const headerFlag = prefix === "-H" ||
      /(?:^|[\s;|&()])(?:-H|--header)(?:=|(?:[ \t]|\\\r?\n)+)$/.test(beforeName);
    const lineStart = Math.max(beforeName.lastIndexOf("\n"), beforeName.lastIndexOf("\r")) + 1;
    const bareLine = !beforeName.slice(lineStart).trim();
    // Quoted headers and -H/--header arguments obey shell word boundaries.
    // Bare HTTP values extend to the line boundary, including cookie separators.
    const shellArgument = !!quote || headerFlag || (!bareLine && word.escapedWhitespace);
    let end = word.end;
    if (!shellArgument) {
      end = valueStart;
      while (end < text.length && text[end] !== "\r" && text[end] !== "\n") end++;
    }
    // Apply generic patterns only outside the masked header, so TOKEN patterns
    // cannot consume its placeholder and closing quote. Restore only the
    // opening quote retained in the prefix, not quotes inside the secret value.
    result += redactSecrets(text.slice(offset, match.index));
    const spacing = shellArgument && !quote ? "" : padding;
    result += `${prefix}${name}${spacing}[REDACTED]${quote && !word.quote ? quote : ""}`;
    offset = end;
  }
  return result + redactSecrets(text.slice(offset));
}

function redactInput(value: unknown, key = ""): unknown {
  if (isCredentialField(key)) return "[REDACTED]";
  if (typeof value === "string") {
    return redactRunText(value);
  }
  if (Array.isArray(value)) {
    if (key.toLowerCase() === "headers" && typeof value[0] === "string" && isCredentialField(value[0])) {
      return value.map((item, index) => index === 0 ? item : "[REDACTED]");
    }
    return value.map((item) => redactInput(item, key));
  }
  if (value && typeof value === "object") {
    const headerName = key.toLowerCase() === "headers" && "name" in value ? value.name : undefined;
    const credentialHeader = typeof headerName === "string" && isCredentialField(headerName);
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [
      name, credentialHeader && name === "value" ? "[REDACTED]" : redactInput(item, name),
    ]));
  }
  return value;
}

function buildRun(members: TaskMessagePayload[]): TaskMessagePayload {
  const first = members[0]!;
  const cached = builtRuns.get(first);
  if (cached?.members.length === members.length &&
      cached.members.every((member, index) => member === members[index])) return cached.message;
  const merged = { ...first };
  if (members.length > 1) {
    merged.content = members.map((member) => member.content ?? "").join("");
    merged.created_at = members.findLast((member) => member.created_at)?.created_at;
  }
  const message = {
    ...merged,
    tool: merged.tool ? redactRunText(merged.tool) : merged.tool,
    content: merged.content ? redactRunText(merged.content) : merged.content,
    output: merged.output ? redactRunText(merged.output) : merged.output,
    input: merged.input ? redactInput(merged.input) as Record<string, unknown> : merged.input,
  };
  builtRuns.set(first, { members, message });
  return message;
}

/** Coalesce before redacting: credentials can span daemon flushes. */
export function buildRunTranscript(
  messages: readonly TaskMessagePayload[],
): TaskMessagePayload[] {
  const items: TaskMessagePayload[] = [];
  const seen = new Set<string>();
  let members: TaskMessagePayload[] = [];
  for (const message of [...messages].sort((a, b) => a.seq - b.seq)) {
    const identity = `${message.task_id}:${message.seq}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const previous = members[members.length - 1];
    if (
      previous &&
      previous.task_id === message.task_id &&
      (message.type === "text" || message.type === "thinking") &&
      previous.type === message.type
    ) {
      members.push(message);
    } else {
      if (members.length) items.push(buildRun(members));
      members = [message];
    }
  }
  if (members.length) items.push(buildRun(members));
  return items;
}

export type RunTranscriptEntry =
  | { kind: "message"; task_id: string; seq: number; message: TaskMessagePayload }
  | { kind: "tool"; task_id: string; seq: number; call?: TaskMessagePayload; result?: TaskMessagePayload };

/** Identified calls pair by ID; legacy calls pair only without overlap. */
export function buildRunTranscriptEntries(messages: readonly TaskMessagePayload[]): RunTranscriptEntry[] {
  const entries: RunTranscriptEntry[] = [];
  const pending = new Map<string, Extract<RunTranscriptEntry, { kind: "tool" }>>();
  const legacy = new Map<string, {
    candidate?: Extract<RunTranscriptEntry, { kind: "tool" }>;
    remaining: number;
  }>();

  for (const message of buildRunTranscript(messages)) {
    const key = message.call_id ? `${message.task_id}:${message.call_id}` : null;
    const legacyKey = !key && message.tool ? `${message.task_id}:${message.tool}` : null;
    if (message.type === "tool_use") {
      const entry = { kind: "tool" as const, task_id: message.task_id, seq: message.seq, call: message };
      entries.push(entry);
      if (key) pending.set(key, entry);
      else if (legacyKey) {
        const bucket = legacy.get(legacyKey);
        if (bucket) {
          // Once calls overlap, no result can identify which one finished.
          bucket.candidate = undefined;
          bucket.remaining++;
        } else {
          legacy.set(legacyKey, { candidate: entry, remaining: 1 });
        }
      }
    } else if (message.type === "tool_result") {
      const bucket = legacyKey ? legacy.get(legacyKey) : undefined;
      const call = key ? pending.get(key) : bucket?.candidate;
      if (bucket && legacyKey && --bucket.remaining === 0) legacy.delete(legacyKey);
      if (call) {
        call.result = message;
        if (key) pending.delete(key);
      } else {
        entries.push({ kind: "tool", task_id: message.task_id, seq: message.seq, result: message });
      }
    } else {
      entries.push({ kind: "message", task_id: message.task_id, seq: message.seq, message });
    }
  }
  return entries;
}

export function runToolContext(call: TaskMessagePayload | undefined): string | undefined {
  const input = call?.input ? redactInput(call.input) as Record<string, unknown> : undefined;
  if (!input) return undefined;
  return SUMMARY_FIELDS.map((name) => input[name])
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

export function runEntrySummary(entry: RunTranscriptEntry): string {
  const text = entry.kind === "tool"
    ? runToolContext(entry.call) || entry.call?.tool || entry.result?.tool || ""
    : entry.message.content || "";
  // Redact the entire value before clipping, including the accessibility label.
  return redactRunText(text).replace(/\s+/g, " ").trim().slice(0, 240);
}

/** Only identified unfinished calls can outrank newer activity. */
export function currentRunEntry(entries: readonly RunTranscriptEntry[]): RunTranscriptEntry | undefined {
  return entries.findLast((entry) => entry.kind === "tool" && entry.call?.call_id && !entry.result)
    ?? entries.findLast((entry) => entry.kind === "tool" || entry.message.content?.trim());
}

export function runToolStatus(
  entry: Extract<RunTranscriptEntry, { kind: "tool" }>,
  status: AgentTask["status"],
): "completed" | "running" | "failed" | "cancelled" | "unavailable" {
  if (entry.result) return "completed";
  if (!entry.call?.call_id) return "unavailable";
  if (isCancellableRunStatus(status)) return "running";
  if (status === "failed" || status === "cancelled") return status;
  // A successful run is not evidence that an unrecorded result succeeded.
  return "unavailable";
}

export function getRunDiagnostics(
  task: Pick<AgentTask, "status" | "failure_reason" | "error">,
) {
  const reasonKey = task.status === "failed" ? failureReasonKey(task.failure_reason) : null;
  const error = task.error?.trim() ? redactRunText(task.error) : null;
  return reasonKey || error ? { reasonKey, error } : null;
}
