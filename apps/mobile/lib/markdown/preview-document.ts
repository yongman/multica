export type PreviewKind = "html" | "mermaid";
export const PREVIEW_MAX_HEIGHT = 360;
export const PREVIEW_MIN_HEIGHT = 72;
export const PREVIEW_MAX_SOURCE_LENGTH = 256_000;
export const MERMAID_MAX_SOURCE_LENGTH = 50_000;
const MESSAGE_KEY = "__multicaMobilePreview";

export interface PreviewTheme {
  dark: boolean;
  tokens: Record<string, string>;
}

export type PreviewMessage =
  | { type: "height"; height: number }
  | { type: "error"; message: string };

/** The bridge only accepts display metrics/errors, never native actions or URLs. */
export function readPreviewMessage(raw: string): PreviewMessage | null {
  if (raw.length > 2048) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const message = data as Record<string, unknown>;
    if (message[MESSAGE_KEY] !== 1) return null;
    if (message.type === "height" && typeof message.height === "number" && Number.isFinite(message.height)) {
      return { type: "height", height: Math.max(PREVIEW_MIN_HEIGHT, Math.min(PREVIEW_MAX_HEIGHT, Math.ceil(message.height))) };
    }
    if (message.type === "error" && typeof message.message === "string") {
      return { type: "error", message: message.message.slice(0, 500) };
    }
  } catch {
    // A page can send arbitrary strings to Android's postMessage interface.
  }
  return null;
}

export function isPreviewNavigationAllowed(url: string): boolean {
  return url === "about:blank" || url === "about:srcdoc" || url.startsWith("about:blank#") || url.startsWith("about:srcdoc#");
}

function scriptValue(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function scriptTag(script: string): string {
  return `<script>${script.replace(/<\/script/gi, "<\\/script")}</script>`;
}

// Matching web's bridge, measure children rather than body.scrollHeight:
// min-height:100vh must not report the iframe's own height back indefinitely.
const MEASUREMENT_SCRIPT = `
(() => {
  const key = ${JSON.stringify(MESSAGE_KEY)};
  const post = data => parent.postMessage({ [key]: 1, ...data }, '*');
  let last = -1, scheduled = false, failed = false;
  const error = message => {
    if (failed) return;
    failed = true;
    post({ type: 'error', message: String(message || 'Preview error').slice(0, 500) });
  };
  window.addEventListener('error', event => {
    if (event.target && event.target !== window) {
      if (event.target.tagName === 'SCRIPT') error('Failed to load script');
    } else error(event.message);
  }, true);
  window.addEventListener('unhandledrejection', event => error(event.reason && event.reason.message || event.reason));
  const measure = () => {
    scheduled = false;
    const body = document.body;
    if (!body) return;
    if (body.hasAttribute('data-wait-for-diagram') && !body.querySelector('#diagram-host svg')) return;
    const range = document.createRange();
    range.selectNodeContents(body);
    const rect = range.getBoundingClientRect();
    let bottom = rect.height ? rect.bottom : 0;
    for (const child of body.children) {
      const style = getComputedStyle(child);
      if (style.display === 'none' || style.position === 'fixed') continue;
      const box = child.getBoundingClientRect();
      if (box.width || box.height) bottom = Math.max(bottom, box.bottom + (parseFloat(style.marginBottom) || 0));
    }
    const style = getComputedStyle(body);
    const height = Math.min(10000, Math.max(0, Math.ceil(bottom + window.scrollY + (parseFloat(style.paddingBottom) || 0) + (parseFloat(style.marginBottom) || 0))));
    if (height !== last) { last = height; post({ type: 'height', height }); }
  };
  const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(measure); } };
  const watch = () => {
    new ResizeObserver(schedule).observe(document.body);
    new MutationObserver(schedule).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    schedule();
  };
  document.addEventListener('DOMContentLoaded', watch, { once: true });
  window.addEventListener('load', schedule);
  // srcdoc fragment links resolve against the host's about:blank base, so
  // scroll locally instead of replacing the frame with a blank document.
  document.addEventListener('click', event => {
    const link = event.target.closest && event.target.closest('a[href]');
    if (!link || event.defaultPrevented) return;
    const href = link.getAttribute('href');
    event.preventDefault();
    if (!href.startsWith('#')) return;
    if (href === '#') { window.scrollTo(0, 0); return; }
    try {
      const id = decodeURIComponent(href.slice(1));
      const target = document.getElementById(id) || document.getElementsByName(id)[0];
      if (target) target.scrollIntoView({ block: 'start' });
    } catch (_) {}
  });
})();
`;

// Author documents stay offline even after opening the full-screen viewer.
// The host policy also applies to srcdoc, so an author cannot relax it with
// their own meta tag. Data images/fonts and inline bundled scripts still work.
const CONTENT_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

/** A trusted bridge hosts an opaque-origin iframe; author markup never enters it. */
export function buildPreviewDocument({
  code,
  kind,
  theme,
  mermaidRuntime = "",
}: {
  code: string;
  kind: PreviewKind;
  theme: PreviewTheme;
  mermaidRuntime?: string;
}): string {
  const declarations = Object.entries(theme.tokens)
    .filter(([name, value]) => /^--[\w-]+$/.test(name) && !/[<>{};\\]|url\s*\(|@|\/\*/i.test(value))
    .map(([name, value]) => `${name}:${value}`)
    .join(";");
  // Like web, authored documents opt into color-scheme by reading app tokens.
  // A hard-coded light page therefore stays light inside the dark app.
  const themed = new RegExp(`var\\(\\s*(?:${Object.keys(theme.tokens).join("|")})(?![\\w-])`).test(code) || kind === "mermaid";
  const scheme = themed && theme.dark ? "dark" : "light";
  const head = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${CONTENT_CSP}"><style>:root{${declarations};color-scheme:${scheme}}</style>${scriptTag(MEASUREMENT_SCRIPT)}`;
  let document: string;
  if (kind === "html") {
    document = head + "</head>" + code.replace(/^\s*<!doctype[^>]*>/i, "") + "</html>";
  } else {
    const render = `
      (async () => {
        try {
          mermaid.initialize({
            startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
            maxTextSize: ${MERMAID_MAX_SOURCE_LENGTH}, maxEdges: 500,
            theme: 'base', htmlLabels: false,
            themeVariables: {
              darkMode: ${theme.dark}, fontFamily: 'sans-serif',
              primaryColor: getComputedStyle(document.documentElement).getPropertyValue('--muted').trim(),
              primaryTextColor: getComputedStyle(document.documentElement).getPropertyValue('--foreground').trim(),
              primaryBorderColor: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),
              lineColor: getComputedStyle(document.documentElement).getPropertyValue('--muted-foreground').trim()
            }
          });
          const { svg } = await mermaid.render('diagram', ${scriptValue(code)});
          document.getElementById('diagram-host').innerHTML = svg;
        } catch (error) {
          parent.postMessage({ ${MESSAGE_KEY}: 1, type: 'error', message: String(error && error.message || error).slice(0, 500) }, '*');
        }
      })();
    `;
    document = head + `<style>html,body{margin:0;background:var(--background);color:var(--foreground);font-family:sans-serif}#diagram-host{padding:12px}svg{display:block;max-width:100%;height:auto}</style></head><body data-wait-for-diagram><div id="diagram-host"></div>${scriptTag(mermaidRuntime)}${scriptTag(render)}</body></html>`;
  }
  const host = `
    const frame = document.getElementById('preview');
    let windowStart = Date.now(), sent = 0;
    window.addEventListener('message', event => {
      if (event.source !== frame.contentWindow || !event.data || event.data[${JSON.stringify(MESSAGE_KEY)}] !== 1) return;
      const data = event.data;
      const now = Date.now();
      if (now - windowStart >= 1000) { windowStart = now; sent = 0; }
      if (sent >= 10) return;
      const bridge = window.MulticaPreviewBridge || window.ReactNativeWebView;
      if (!bridge) return;
      if (data.type === 'height' && Number.isFinite(data.height)) {
        sent++;
        bridge.postMessage(JSON.stringify({ ${MESSAGE_KEY}: 1, type: 'height', height: Math.max(0, Math.min(10000, data.height)) }));
      } else if (data.type === 'error' && typeof data.message === 'string') {
        sent++;
        bridge.postMessage(JSON.stringify({ ${MESSAGE_KEY}: 1, type: 'error', message: data.message.slice(0, 500) }));
      }
    });
    frame.srcdoc = ${scriptValue(document)};
  `;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${CONTENT_CSP.replace("frame-src 'none'", "frame-src about:")}"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${scheme === "dark" ? "#0a0a0a" : "#fff"}}iframe{display:block;border:0;width:100%;height:100%}</style></head><body><iframe id="preview" title="Preview" sandbox="allow-scripts"></iframe>${scriptTag(host)}</body></html>`;
}
