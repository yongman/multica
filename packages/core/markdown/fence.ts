/** CommonMark fence rules shared by the web and native rich-block dispatchers. */
export function richFenceLanguage(info: string | null | undefined): "html" | "mermaid" | null {
  const language = info?.trim().split(/\s+/, 1)[0];
  return language === "html" || language === "mermaid" ? language : null;
}

export function isClosedFence(raw: string): boolean {
  const lines = raw.replace(/\r\n?/g, "\n").trimEnd().split("\n");
  const opener = /^ {0,3}(`{3,}|~{3,})/.exec(lines[0] ?? "")?.[1];
  if (!opener || lines.length < 2) return false;
  const closer = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines.at(-1) ?? "")?.[1];
  return !!closer && closer[0] === opener[0] && closer.length >= opener.length;
}

/** Double-quoted, single-quoted or unquoted title in a fence's info string. */
export function parseFenceTitle(meta: string | null | undefined): string | null {
  const match = /(?:^|\s)title=(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(meta ?? "");
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim() || null;
}
