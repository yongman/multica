import type { THEME } from "@/lib/theme";
import type { PreviewTheme } from "./preview-document";

/** Map mobile's resolved palette onto the CSS names used by web HTML blocks. */
export function previewTheme(palette: typeof THEME.light, dark: boolean): PreviewTheme {
  const tokens: Record<string, string> = {};
  for (const [name, value] of Object.entries(palette)) {
    tokens[`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/^chart(\d)$/, "chart-$1")}`] = value;
  }
  Object.assign(tokens, {
    "--surface": palette.surface1,
    "--surface-raised": palette.surface2,
    "--surface-hover": palette.accent,
    "--surface-selected": palette.accent,
    "--surface-border": palette.border,
    "--page-canvas": palette.background,
    "--faint-foreground": palette.mutedForeground,
    "--code-block-background": palette.codeSurface,
    "--code-block-color": palette.foreground,
    "--font-ui": "system-ui, sans-serif",
    "--font-sans": "system-ui, sans-serif",
    "--font-content": "system-ui, sans-serif",
    "--font-mono": "monospace",
    "--text-body": "14px",
    "--text-caption": "12px",
    "--color-scheme": dark ? "dark" : "light",
  });
  return { dark, tokens };
}
