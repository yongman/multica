# ADR — Markdown rendering on `apps/mobile/`

**Status**: Accepted
**Date**: 2026-05-19

This is the durable architecture-decision record for how the mobile app
renders markdown — the **one-page answer** to "what are we using and why"
with A-tier sources.

---

## Context — what the RN ecosystem actually offers (2026-05)

There are exactly three rendering paths available for markdown in React
Native today. Each has hard, library-independent constraints rooted in
the RN platform itself:

| Path | How it renders | Strengths | Hard limits |
|---|---|---|---|
| **A — Native** | md4c parses → iOS `NSAttributedString` / Android Spannable | Fastest, doesn't touch RN's nested-`<Text>` layout path | Cannot inject custom React for any leaf node (`enriched-markdown` issue [#54](https://github.com/software-mansion-labs/react-native-enriched-markdown/issues/54), [#232](https://github.com/software-mansion-labs/react-native-enriched-markdown/issues/232), maintainer: "no custom renderers, by design") |
| **B — React tree** | Parse to AST → walk → render every token as nested `<Text>` / `<View>` | Full custom React rendering for every node | Triggers RN's 10-year-old nested-`<Text>` bugs: [#10775](https://github.com/facebook/react-native/issues/10775), [#45925](https://github.com/facebook/react-native/issues/45925), [#6728](https://github.com/facebook/react-native/issues/6728) — `borderWidth` / `padding` / `margin` are not `NSAttributedString` attributes and either silently drop or force-break inline runs. CJK paragraphs amplify the symptom via UAX #14 / Kinsoku. |
| **C — WebView** | Web markdown lib (e.g. `react-markdown`) inside `react-native-webview` / Expo DOM Components | Identical to web output | Slower startup (no Hermes bytecode), async JSON-only bridge, native UI cannot embed inside the WebView, scroll & keyboard UX divergent. Expo's own docs acknowledge these are public trade-offs ([dom-components.mdx](https://docs.expo.dev/guides/dom-components/)) |

**Fact**: as of 2026-05, **no single library satisfies path A + path B
simultaneously** — i.e. native rendering performance AND custom React
component for arbitrary leaf nodes. This is an ecosystem-level constraint,
not a Multica problem.

### Concrete library survey (2026-05)

| Library | Path | Last release | Verdict for Multica |
|---|---|---|---|
| [`react-native-enriched-markdown`](https://github.com/software-mansion/enriched-markdown) | A | v0.6.0 (May 2026) | **Selected for prose.** Expo officially recommends it in [Edit rich text](https://docs.expo.dev/guides/editing-richtext/) — A-tier endorsement. Software Mansion (same team as Reanimated / Gesture Handler) |
| [`react-native-streamdown`](https://github.com/software-mansion-labs/react-native-streamdown) | A + worklets | active 2026 | Not adopted. Built on enriched-markdown, optimised for AI streaming. Web/desktop don't use a streaming-specific renderer either, mobile streaming isn't currently a top product pain |
| [`react-native-marked`](https://github.com/gmsgowtham/react-native-marked) | B | v8.1.0 (2026-05-14) | Not adopted. v7 removed `CustomToken`, v8 added "React component embedding" but no token-level customisation. Pure `<Text>` tree → would trigger nested-text bugs |
| [`amilmohd155/react-native-markdown`](https://github.com/amilmohd155/react-native-markdown) | B | v0.8.5 (Jan 2026) | Not adopted. Same nested-`<Text>` constraint as `react-native-marked`. 14 ⭐, single maintainer, not production-validated |
| [`react-native-markdown-display`](https://www.npmjs.com/package/react-native-markdown-display) | B | ~2 years stale | Maintainer publicly recommends migrating away |
| Expo DOM Components (web `react-markdown` inside WebView) | C | Expo SDK 53+ stable | Not adopted as primary. Reserved as escape hatch for future LaTeX / Mermaid / very wide tables |
| [`vercel/streamdown`](https://github.com/vercel/streamdown) | n/a | active 2026 | Not applicable — name collides with SM's RN library but Vercel's `streamdown` is **web-only** (Next.js, AI SDK). Documented here only to dispel confusion |

Closed-source production references like Stream Chat's [`StreamingMessageView`](https://getstream.io/blog/react-native-assistant/) and [assistant-ui](https://www.assistant-ui.com/blog/2026-03-launch-week) do not publish their RN markdown implementation. There is **no public industry standard**.

---

## Decision

Multica mobile uses a **segment-based hybrid renderer** that dispatches
each markdown token type to the renderer that doesn't trip on that
token's specific platform trap.

```
content (string)
  ↓ preprocessMobileMarkdown
     legacy mention shortcode  →  [@name](mention://type/id)
     image file-card lines     →  ![name](url)
     other file-card lines     →  [📎 name](url)
     HTML <br>                 →  CommonMark "  \n" hard break
  ↓ splitMarkdown                 (marked@18 lexer; we use the AST only)
     code fence          → { type:'code',  lang, code }
     paragraph w/ image  → image promoted to block, text rejoins prose
     everything else     → { type:'prose', content: token.raw }
  ↓ render per-segment
     prose  → <EnrichedMarkdownText>   path A
     code   → <CodeBlock>              path B (controlled — no CJK mixing)
     image  → <MarkdownImage>          path B (controlled — single element)
```

Each per-segment routing decision avoids the failure mode of the path it
chose:

| Segment | Routing | Trap avoided |
|---|---|---|
| Prose (paragraphs, headings, lists, quotes, tables, inline code, links, strong/em) | enriched-markdown (path A) | Would otherwise need React tree → CJK + inline-code chip = 5-7 line breakage per chip (the 2026-05-09 incident) |
| Fenced code block | own `CodeBlock` with one `<Text>` per line, token spans nested but **content is code only — no CJK paragraphs to trigger UAX #14**. Shiki for highlighting | Native rendering can't expose Shiki tokens; React tree of code-only doesn't trigger the CJK amplification of the nested-text bug |
| Image | `expo-image` wrapped in `Pressable` for lightbox dispatch. **One element, no nested-text mixing** | RN `<Image>` can't be inline in `<Text>`; lightbox needs `Pressable` not addressable inside attributed string |
| Inline / display LaTeX | enriched-markdown's native math backend; Android oversized inline formulas use wrapping source fallback | Keeps formulas native without adding a WebView to prose |
| (future) Mermaid | when needed, a separate component running Expo DOM Components | Avoids adding WebView startup cost to ordinary prose |

### Marked@18 is used as a **lexer only**

`marked.lexer(input)` produces a token list. We never feed `marked`'s
HTML output to anything. `marked` is a 10-year-old, A-tier-maintained
CommonMark/GFM lexer ([marked.js docs](https://marked.js.org/)), and
running it as a pure JS function on every markdown body is cheap.

This is necessary because enriched-markdown's internal md4c AST is not
exposed — we'd have no way to find segment boundaries otherwise.

### Theming

Colors flow from the RNR design system:

- `global.css` defines CSS variables under `:root` (light) and
  `.dark:root` (dark)
- `lib/theme.ts` mirrors these as pre-resolved `hsl(...)` strings
  (CSS variable syntax doesn't work in RN imperative style objects)
- `lib/use-color-scheme.ts` is the single source of truth for the
  current scheme, persisted in `expo-secure-store`

For prose (path A, must use imperative style object — enriched is native
md4c, no className support), `useMarkdownStyle()` derives the full style
object from `THEME[scheme]`. For non-prose (paths B controlled), all
container styling uses NativeWind className like the rest of RNR.

### enriched-markdown's hidden-default trap (documented for posterity)

enriched-markdown's `normalizeMarkdownStyle.js` carries a frozen table of
~30 hardcoded **light-mode** color defaults. Fields not explicitly
overridden in `useMarkdownStyle()` use those hardcoded values and
disappear (or render garishly) in dark mode. Every color field must be
explicitly mapped to a `THEME[scheme]` token. Version 0.6.0 adds a transparent
link background plus link-variant, superscript, and subscript defaults; none
introduce a new opaque color. Re-audit `normalizeMarkdownStyle.js` on every
upgrade because newly-added color fields may ship light-mode defaults.

---

## Consequences

### What we get

- Native attributed-string performance for the 95% case (prose)
- Web-parity syntax highlighting (Shiki, same themes as web)
- Image lightbox with native `expo-image` caching
- Full GFM support via enriched-markdown's `flavor="github"`
- Light / dark mode that follows `lib/use-color-scheme`
- Expo's own A-tier recommendation as our prose engine

### What we pay

- Three rendering paths to maintain instead of one
- Theme integration: every enriched color field must be explicitly mapped;
  hidden-default trap re-emerges on every enriched upgrade
- Code blocks nested in a list item stay with the enriched prose stream
  (don't get Shiki) — top-level code is the >95% case, acceptable
- Mermaid is not rendered natively; LaTeX depends on enriched-markdown's native math backend

### Known limitations and mitigations

**Markdown viewport width.** Comment bodies (root and flattened descendant
replies), the shared Markdown wrapper, and each native prose island have an
explicit `minWidth: 0` / `maxWidth: "100%"` boundary. Native prose stretches to
the width its host provides; it does not set a fixed screen width, so padded
comments, narrower reply hosts, descriptions, and compact chat bubbles can
reuse it. Author names can shrink independently of the avatar and timestamp.
The code block clips its *scroll viewport*, with the complete source still
inside the horizontal ScrollView. Image dimensions remain relative to the
body, regardless of authored HTML dimensions. Prose is not truncated, and no
invisible break characters are inserted into text, link destinations, or copy
contents.

The Android enriched-markdown patch also keeps all three `StaticLayout`
measurement paths within the available width:

- Round the available pixel width **down** before laying out text. Rounding a
  fractional constraint up can measure fewer lines than fit when Fabric lays
  out the integer-width TextView.
- Bound cached/fallback intrinsic width by the input constraint, as the GFM
  split path already does. An indivisible replacement span can have an
  intrinsic width larger than the layout, and that width must not enlarge
  the Yoga viewport.

**Android inline math.** A `MathInlineSpan` bitmap cannot split across lines.
When it exceeds the width of a fresh line (after text padding and list/quote
leading margins), the native text view displays its complete `$LaTeX$` source
as ordinary wrapping text, retaining the formula's font size and theme color
even in a math-only paragraph. Short formulas still use their math bitmaps.
The original Spannable is retained, so growing the viewport restores the
bitmap instead of keeping a permanent source downgrade. The same width
adapter runs on background measurement placeholders and on displayed text,
including table cell height measurement, to keep the height supplied to
Fabric consistent with the fallback. This is a native Android rule; the
JavaScript Markdown source and the iOS renderer are unchanged. Wide display
math continues to use its existing horizontal scroll container.

Timeout/error math metrics carry an explicit estimate flag through the
background placeholder. Their width is capped at `20 * fontSize` and cannot
prove that the real bitmap fits. Such placeholders always measure the complete
wrapping source, reserving its height even when the capped width fits. Exact
metrics still use the normal width check, so short formulas retain bitmap
rendering. A regression test uses the real helper timeout on a worker thread
and replays the GFM allocation at 320px against a 900px display bitmap.

The rendering routes remain:

| Content | Width behavior |
| --- | --- |
| Paragraphs, URLs/paths, inline code, mentions, mixed emphasis, headings | Native text wraps inside the prose viewport; source and link targets are unchanged |
| Quotes, lists, task lists, code nested inside lists/quotes | Native leading margins reduce the space available to text; nested code keeps its existing wrapping fallback |
| Top-level fenced or indented code | Full source inside a bounded React horizontal ScrollView |
| Wide/narrow GFM tables and display math | Bounded native `OverflowHorizontalScrollView` with early Android touch arbitration |
| Android inline math | Fitting bitmaps stay inline; oversized bitmaps become complete wrapping LaTeX source |
| Top-level Markdown/HTML images | `expo-image` at body-relative width, with aspect ratio and lightbox preserved |
| Embedded HTML | Preprocessing strips layout tags/attributes and retains text/images; comment bodies do not host WebViews |

`MarkdownWidthTest` uses API 32 Robolectric native graphics to check fractional
and oversized-span measurements, actual `EnrichedMarkdownInternalText`
wrapping at 320/360/412 dp minus card padding and 0/24/48 dp reply indentation,
and reflow of large selectable text. Its text spans model links, code,
headings, and list/quote margins; it does not execute the JNI md4c parser or
React Native Yoga. `MarkdownGfmLayoutTest` calls the public measurement entry
with GFM splitting enabled, uses the returned height as the exact TextView
allocation, and checks complete text, line bounds, and last-line visibility.
It finds a one-pixel line-wrap threshold to exercise the fractional GFM width
path directly, and covers oversized math, leading margins, restoration at a
wider width, fitting formulas, source font/color, and table cells. The
unavailable md4c JNI parser is replaced by a deterministic AST shadow. Most
math cases use a deterministic metrics shadow; the timeout regression runs the
real `MathMeasureHelper` with its main looper paused. Native span rendering,
GFM measurement, and TextView layout are real.

Vitest covers real preprocessing/segment routing and headless root/descendant
`CommentCard` wiring. `markdown.test.ts` directly calls `Markdown` with
synthetic `selectable`/`compact` props representing comment, reader, and
compact-message contracts. It does not mount `IssueDescription`,
`ChatTimeline`, or `ChatMessageList`, and does not verify those screens'
rendered layout. Neither suite replaces Android/iOS device testing. Use
[the complete fixture](markdown-overflow-fixture.md) for both themes,
selection, rotation, large fonts, images, and nested gestures.

**Android horizontal overflow inside a vertical list.** Native Markdown tables
and display math use the patched `OverflowHorizontalScrollView` from
`react-native-enriched-markdown`. Code blocks keep React Native's horizontal
`ScrollView`, selectable text, Shiki spans, and copy header. On Android only,
an app-local Expo `MarkdownScrollGuard` view surrounds that ScrollView and
uses the same patched `HorizontalScrollGesture` as native tables/math.
Expo autolinks `modules/markdown-scroll-guard`; its Android Gradle dependency
on enriched-markdown makes the shared arbiter available without duplicating
the gesture algorithm. The iOS guard returns its children unchanged.

Android dispatches a parent's interception check before a child's MOVE.
Waiting until a horizontal MOVE to call `requestDisallowInterceptTouchEvent`
therefore loses diagonal drags to vertical ancestors. The earlier native
table fix started a vertical nested scroll on DOWN; that happens to suppress
interception in an ordinary Android `ScrollView` which accepts nested scrolls.
It does not protect against an ancestor that arbitrates independently or
declines nested scrolling. Code blocks previously used an unguarded RN
ScrollView and had no provisional protection at all. `nestedScrollEnabled`
alone does not fix this dispatch ordering.

For either renderer, the shared arbiter:

- Reserves the stream on DOWN **only when content overflows**, before the
  ancestor can consume the first diagonal MOVE, retaining nested-scroll
  participation during this short phase.
- Uses the system touch slop and horizontal dominance (`abs(dx) > abs(dy)`),
  with no extra angle or distance threshold. It locks horizontally only when
  the content can scroll in the initial drag direction. The lock lasts until
  UP/CANCEL, including at an edge, so reversing direction remains smooth.
- Cancels the pending child press and releases interception for vertical
  intent or an initial outward drag at an edge. The parent handles subsequent
  moves normally. Narrow blocks never reserve the stream.
- Clears a selectable child's interception veto when horizontal intent wins,
  and releases all protection on UP/CANCEL. Stationary taps and long presses
  still reach the child. Native tables/math also notify the React root when
  scrolling starts/ends so an enclosing JS Pressable cannot fire its comment
  action long press while the block is being dragged.

An undecided gesture with a second pointer yields to the page before the
original pointer can lift. Interception protection otherwise hides pointer
changes from the parent and can leave it tracking a pointer that no longer
exists. An already locked horizontal drag keeps its lock.

This applies through the shared Markdown renderer to issue descriptions,
root/descendant comments, chat message bodies, and Markdown attachment previews.
Prose and long URLs/paths still wrap. `ChatTimeline` tool output is wrapping
text rather than a horizontal viewport; actual chat Markdown lives in
`ChatMessageList`. HTML attachments use a standalone WebView with its own
document scrolling and no enclosing RN vertical ScrollView. There is no
Android drawer, swipeable tab pager, or full-screen navigation pan on these
surfaces. The existing width constraints and clipping remain in place; neither
the arbiter nor its Yoga-managed code host measures or enlarges the viewport.

After Android prebuild, run the API 32 Robolectric tests from `apps/mobile/android`:

```bash
./gradlew :react-native-enriched-markdown:testDebugUnitTest --tests '*OverflowHorizontalScrollViewTest' --tests '*MarkdownWidthTest' --tests '*MarkdownGfmLayoutTest'
```

`OverflowHorizontalScrollViewTest` dispatches complete finger event streams
through a real vertical page, both with and without nested-scroll acceptance.
The latter reproduces the old table failure. It covers the native block and
the guard/delegate structure used by RN code, horizontal slopes from 0 to
0.9 in either vertical direction at 8/32/120ms sample intervals, both scroll
directions, edge reversal, vertical handoff, narrow content, pointer switching,
tap/link/long-press preservation, selectable text, React responder cancellation,
and UP/CANCEL cleanup. The code delegate in this suite is Android's
`HorizontalScrollView`, not Fabric's RN ScrollView. Vitest checks the real
CodeBlock's guard/ScrollView/selection/copy wiring and the timeline's keyboard
and selection callbacks; it does not simulate native event dispatch.
These checks do not establish real-device gesture success rates, Fabric layout,
HTML WebView behavior, or iOS visual parity.

For regression testing, paste this fixture into a Markdown attachment, an issue
description, a comment, or a chat message. Add enough prose after it for the
page to scroll vertically.

````markdown
| First column | Second column | Third column | Fourth column | Fifth column | Last column |
| ------------ | ------------- | ------------ | ------------- | ------------ | ----------- |
| Start A      | Field B       | Field C      | Field D       | Field E      | End F       |

| Narrow | Table |
| ------ | ----- |
| A      | B     |

```text
Code start 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 code end
```

$$
\frac{a+b+c+d+e+f+g+h+i+j+k+l+m+n+o+p+q+r+s+t+u+v+w+x+y+z}{1+2+3+4+5+6+7+8+9}
$$
````

- Drag left across the wide table with slight vertical movement, then back
  right. Both ends of the table should be reachable.
- Start a vertical drag over each table. The page should scroll without moving
  the tables horizontally.
- Check that the narrow table still responds to long-press and that the code
  block and any overflowing equation can reach their last characters.

**Inline code chip top-heavy padding** — visible as `~13pt empty space
above` vs `~3pt below` glyphs in chips inside CJK paragraphs (seen in
#MUL-2397 and #MUL-2395 dark screenshots, 2026-05-19).

- **Root cause**: enriched-markdown applies hardcoded internal padding
  to inline code that cannot be turned off via `markdownStyle.code`. The
  `CodeStyle` schema does not expose `padding*` / `baselineOffset` /
  `lineHeight` knobs.
- **Not an RN/iOS platform issue**: Discord, Slack, Telegram, Mattermost
  mobile all render inline code with background + monospace and **do
  not** show this asymmetry — confirming the artifact is library-specific.
- **Upstream tracking**: [`software-mansion-labs/react-native-enriched-markdown#255`](https://github.com/software-mansion-labs/react-native-enriched-markdown/issues/255)
  (filed 2026-04-20 by `@xindixu`, maintainer unresponsive as of 2026-05-19).
- **Failed mitigation (reverted 2026-05-19, same day)**: reducing
  `MD_LINE.body` from 24 to 20 shrinks absolute padding but does not
  change the asymmetry ratio (still ≈ 4:1 — enriched sets the padding
  distribution internally) — net negative, cost CJK leading and didn't
  fix the chip.

**Mitigation applied (2026-05-19)** — inline code rendered WITHOUT a
background:

```ts
code: {
  color: t.brand,
  backgroundColor: "transparent",
  borderColor: "transparent",
  fontFamily: MONO_FONT,  // Menlo on iOS, monospace on Android
},
```

- `backgroundColor: "transparent"` — enriched still paints the padding
  rectangle internally, but it's invisible, so the top-heavy artifact
  disappears. Glyph baselines are unaffected (baseline is a font-metric
  property, not a background-painting property).
- `fontFamily: MONO_FONT` — enriched's native default for `code` is `''`
  (inherit from paragraph), so without this override mobile inline code
  would lose its only visual identity once the chip is removed.
- `color: t.brand` — secondary identification tint, distinguishes inline
  code from regular prose alongside the monospace.
- **Visual trade-off**: mobile no longer matches web/desktop chip style.
  Inline code on mobile reads as "tinted monospace span". Acceptable
  given that the alternative is the top-heavy chip artifact.
- **Revisit when**: upstream issue #255 ships a padding control. At
  that point switch back to a tinted-background chip for cross-platform
  parity.

**Why we did NOT** fork the library or rewrite the prose layer to a
React-tree renderer:

- Forking enriched-markdown means maintaining a native-code (ObjC/Swift
  + Kotlin) patch indefinitely; the ROI for one styling fix is poor.
- Rewriting the prose layer to a React-tree renderer (e.g.
  `react-native-marked`) would re-introduce the RN nested-`<Text>`
  platform bugs documented above — same root cause as the 2026-05-09
  inline-code CJK line-breakage incident.

### What's explicitly out of scope

- **Replacing the whole stack with a single library**: every alternative
  surveyed above either drops path A (perf) or drops custom React (lightbox /
  syntax highlight). No path forward there until the ecosystem ships a
  library that satisfies both.
- **Migrating chat to streamdown**: web/desktop have no streaming-specific
  renderer either; mobile parity demands the same. Reconsider only if
  AI-chat streaming becomes a top user complaint.

---

## When to revisit this ADR

- enriched-markdown ships custom React leaf-node rendering (currently
  not on roadmap — roadmap addresses `EnrichedMarkdownTextInput`, the
  *editor*, not the *renderer*)
- A new library appears that satisfies path A + path B simultaneously
- Expo SDK ships a first-party markdown renderer (currently doesn't)
- The product team commits to LaTeX / Mermaid as core features — Expo
  DOM Components becomes the right answer for that surface

---

## Sources (A-tier only)

### Official documentation

- [Expo — Edit rich text guide](https://docs.expo.dev/guides/editing-richtext/) — directly recommends `react-native-enriched-markdown`
- [Expo — Using React DOM in Expo native apps](https://docs.expo.dev/guides/dom-components/) — DOM Components trade-offs (path C)

### Library sources (maintainer-authoritative)

- [`software-mansion-labs/react-native-enriched-markdown`](https://github.com/software-mansion-labs/react-native-enriched-markdown) — path A primary
- [`software-mansion-labs/react-native-streamdown`](https://github.com/software-mansion-labs/react-native-streamdown) — surveyed, not adopted
- [`gmsgowtham/react-native-marked`](https://github.com/gmsgowtham/react-native-marked) — path B surveyed
- [`amilmohd155/react-native-markdown`](https://github.com/amilmohd155/react-native-markdown) — path B surveyed
- [`vercel/streamdown`](https://github.com/vercel/streamdown) — web only, documented to dispel naming collision
- [marked.js documentation](https://marked.js.org/) — lexer we use
- [Shiki](https://shiki.style/) + [`react-native-shiki-engine`](https://www.npmjs.com/package/react-native-shiki-engine) — code highlighting
- [`expo-image`](https://docs.expo.dev/versions/latest/sdk/image/) + [`jobtoday/react-native-image-viewing`](https://github.com/jobtoday/react-native-image-viewing) — image rendering
- [md4c](https://github.com/mity/md4c) — the C library that backs enriched-markdown on native

### Platform constraint sources (the "why we can't just use path B everywhere")

- [`facebook/react-native#10775`](https://github.com/facebook/react-native/issues/10775) — nested-`<Text>` border ignored (Nov 2016, locked, no fix)
- [`facebook/react-native#45925`](https://github.com/facebook/react-native/issues/45925) — same bug re-filed, still open under New Architecture
- [`facebook/react-native#6728`](https://github.com/facebook/react-native/issues/6728) — `margin` / `padding` ignored on nested `<Text>`
- [`react-native-community/discussions-and-proposals#695`](https://github.com/react-native-community/discussions-and-proposals/issues/695) — official statement on inline-text styling limits

### Reference implementations (same-pattern peers)

- [Mattermost mobile — `app/components/markdown/`](https://github.com/mattermost/mattermost-mobile/tree/main/app/components/markdown) — same segment-dispatch pattern, different engines
- Stream Chat [`StreamingMessageView`](https://getstream.io/blog/react-native-assistant/) — closed-source, recorded only as evidence that "no public standard exists"
- [assistant-ui multi-platform launch](https://www.assistant-ui.com/blog/2026-03-launch-week) — closed-source

### In-repo cross-references

- `apps/mobile/lib/markdown/markdown.tsx` — entry point
- `apps/mobile/lib/markdown/split-markdown.ts` — segment splitter
- `apps/mobile/lib/markdown/markdown-style.ts` — `useMarkdownStyle()` theme bridge
- `apps/mobile/lib/markdown/code-block.tsx` — Shiki-powered code segment
- `apps/mobile/lib/markdown/markdown-image.tsx` — lightbox-aware image segment
- `apps/mobile/AGENTS.md` — mobile-wide rules including theme/CSS-variable system
