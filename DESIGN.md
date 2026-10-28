---
name: AShareSim · AI Conversation
description: Reference-led continuous conversation with local process disclosures for the light Android app.
colors:
  page: "#FAFAF9"
  paper: "#FFFFFF"
  ink: "#242423"
  secondary: "#666662"
  muted: "#767670"
  line: "#E2E2DE"
  soft: "#F4F4F2"
  user: "#EFEFEE"
  accent: "#666662"
  code: "#9D3E33"
  action: "#333330"
  disabled: "#DEDEDA"
  error: "#E5322D"
  success: "#0E9F5B"
  warning-bg: "#FFF3E0"
  warning-ink: "#8A4B00"
typography:
  headline:
    fontSize: "21px"
    fontWeight: 600
    lineHeight: "30px"
  title:
    fontSize: "18px"
    fontWeight: 600
    lineHeight: "27px"
  subheading:
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "25px"
  body:
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "25px"
  user-body:
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "25px"
  composer:
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "24px"
  table:
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "22px"
  label:
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
  detail:
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "19px"
  toolbar-label:
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "18px"
  field:
    fontSize: "14px"
    fontWeight: 400
  choice-label:
    fontSize: "15px"
    fontWeight: 500
  code-block:
    fontFamily: monospace
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
  inline-code:
    fontFamily: monospace
    fontSize: "13px"
rounded:
  tag: "4px"
  provider-mark: "8px"
  search-field: "10px"
  content: "12px"
  operation-card: "14px"
  user-bubble: "12px"
  send-disc: "16px"
  composer: "18px"
  sheet: "22px"
  latest-button: "24px"
spacing:
  inline: "4px"
  compact: "6px"
  control-gap: "8px"
  row-gap: "10px"
  inset: "12px"
  paragraph: "12px"
  section: "16px"
  reading-gutter: "16px"
  heading-before: "20px"
components:
  assistant-answer:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "0px"
  user-bubble:
    backgroundColor: "{colors.user}"
    textColor: "{colors.ink}"
    typography: "{typography.user-body}"
    rounded: "{rounded.user-bubble}"
    padding: "10px 12px"
  composer:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.composer}"
    rounded: "{rounded.composer}"
    padding: "4px"
  button-send:
    backgroundColor: "{colors.action}"
    textColor: "{colors.paper}"
    rounded: "{rounded.send-disc}"
    height: "32px"
    width: "32px"
  button-send-disabled:
    backgroundColor: "{colors.disabled}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.send-disc}"
    height: "32px"
    width: "32px"
  disclosure:
    textColor: "{colors.secondary}"
    typography: "{typography.label}"
    padding: "0px"
  chip-capability:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tag}"
    padding: "3px 6px"
  input-model-search:
    textColor: "{colors.ink}"
    typography: "{typography.field}"
    rounded: "{rounded.search-field}"
    padding: "10px 12px"
  markdown-table:
    textColor: "{colors.ink}"
    typography: "{typography.table}"
    rounded: "{rounded.content}"
  code-block:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.ink}"
    typography: "{typography.code-block}"
    rounded: "{rounded.content}"
    padding: "14px"
  operation-card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.operation-card}"
    padding: "16px"
  chat-navigation:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
  model-choice:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    typography: "{typography.choice-label}"
    padding: "16px"
---

# Design System: AShareSim · AI Conversation

## Overview

**Creative North Star: "参考图的连续对话与局部过程（Android 适配）"**

The user-selected references establish a continuous conversation on a near-white field: native Chinese text, quiet local process summaries, a pale right-aligned question, and a single bottom composer. Tool stages stay beside the explanation that follows them; the assistant reads as continuous analysis rather than a sequence of white message cards. This is a code-led adaptation of `docs/design/references/agent-conversation.png` and `agent-expanded.png`, with no generated imagery or shipping raster assets.

This system applies to the Android AI conversation, its Markdown renderer, and in-chat model/thinking selectors. It does not replace the stock application's visual world. Trading screens retain the cool gray background, white cards, compact controls, tabular numerals, red rises/green falls, and existing semantic colors in `src/ui/theme.ts` and `src/ui/components/ui.tsx`. Shared operation buttons inside the conversation retain those established action semantics.

The current system is recorded from `codex/release-agent-ui-preview`, based on v0.9.0. It is light-only. The system-dark capture verifies that the existing light app remains legible; it does not establish a dark palette. Eight native Android phone captures cover normal type, 1.3× type, a narrower phone, keyboard, empty state, model sheet, table, and expanded details. `.impeccable/review/agent-finish-review.md` records disposition **ship**. Physical hardware, a full TalkBack traversal, iOS, tablet, and live supplier calls remain unverified. Earlier `composer-review.md` and chat-detail records describe past versions; they are not the current preview verdict.

**Key Characteristics:**

- Continuous assistant text with paragraph and heading rhythm.
- Near-white neutral surfaces; dark primary action; semantic color reserved for actual state.
- Native font scaling, touch controls, and safe-area/keyboard accommodation.
- Compact two-layer composer with left-aligned draft and model name.
- Local collapsed process stages with visible errors and explicit operation confirmation.
- Local AI styling that preserves the surrounding trading interface.

## Colors

The AI palette is near-neutral and low-chroma; text and surface contrast establish hierarchy before color does. Frontmatter values are normative and come from `src/ui/aiTheme.ts`, with the four shared status colors drawn from `src/ui/theme.ts`.

### Primary

- **Charcoal action (`action`)** fills the enabled send/stop disc; its icon uses paper white. The disabled disc uses `disabled` with secondary ink.

### Neutral

- **Near-white page (`page`)** is the continuous reading field, header, composer surround, and selector sheet.
- **Paper (`paper`)** is the composer interior, operation card, return-to-latest button, and menu.
- **Deep ink (`ink`)** carries prose, headings, model choices, and underlined links.
- **Secondary ink (`secondary`)** carries context, tool summaries, list markers, quoted text, and supporting labels.
- **Quiet gray (`accent`)** marks native text selection and the selected search icon/dot. Busy indicators also use secondary gray. These state cues stay restrained; error red remains distinct.
- **Muted ink (`muted`)** carries attachment and usage metadata and placeholders; it remains distinct from disabled fills.
- **Quiet line (`line`)** separates table rows and bounds fields, cards, and the composer.
- **Soft surface (`soft`)** supports code, table headers, selected filter/model rows, capability tags, memory strips, and expanded usage. Tool process details use paper white.
- **Question gray (`user`)** distinguishes the user's message without a colored chat bubble.
- **Code rust (`code`)** distinguishes inline code on the soft surface.

### Semantic state

- **Error red (`error`)** and **success green (`success`)** retain the shared app meanings for failed tools and operation results.
- **Warning ink/background (`warning-ink`, `warning-bg`)** carry capability limits and a reversible cache-change notice.
- Provider identity marks use the configured preset color in `src/ai/models.ts`; they are identity data, not a new global accent scale.

**The Local Palette Rule.** Use this near-neutral palette only on the AI reading surface and its chat selectors. Preserve the existing stock application's red/green market semantics and shared action colors.

## Typography

Prose and controls use the native Android default font and its Chinese fallback; the app does not load a custom reading font. Only code explicitly selects Android `monospace`. The frontmatter's `px` notation serializes native baseline values: React Native layout values are dp, and text sizes scale as native text. It is not a CSS implementation prescription.

The type scale is role-based, with no asserted modular ratio. `headline`, `title`, and `subheading` are Markdown levels one through three. Body text has a generous line height; bold and headings use semibold. User text is slightly tighter. Table text, tool summaries, and detail labels step down without changing family. Tabular numeral features are applied to table cells and numeric metadata through the existing `num` style.

Heading spacing is asymmetric: more space before a new section than after it. The first heading removes its leading margin. Paragraphs separate with the `paragraph` spacing token; lists use a hanging marker, modest space between items, and a larger final gap. Inline citations are small secondary labels, while normal links remain underlined deep ink. Do not treat model or usage labels as repeated answer headings.

**The Reading Hierarchy Rule.** Keep the native body role and its line height as the default for assistant prose. Use the three observed heading roles for content structure and semibold for local emphasis.

**The Composer Alignment Rule.** Keep the draft and model label on the same left inset. Keep search and thinking visually light, with the send disc at the right and full touch targets around the compact symbols.

## Layout

The phone has a compact app bar, one vertical conversation scroll view, and one bottom composer. The app bar shows conversation title and a context entry; it does not reproduce the desktop sidebar. Its row has a minimum height of 56dp and accommodates the top safe area. The reading container is centered, fills available width, has 16dp side gutters, and caps its outer width at 760dp. The bottom container shares that cap, with 12dp outer side padding. This width cap is implemented behavior, not a claim of tablet validation.

Assistant messages have no enclosing card padding. Questions align right and use at most 90% of the reading width. The compact composer contains a multiline draft above a model/search/thinking/send row. Both the draft and model text start 10dp inside the container's 4dp padding. The model uses flexible remaining width, left alignment, and a one-line label; its full value remains available to accessibility. The draft grows from 36dp to 132dp with 6dp vertical padding and 4dp hit slop. Search is always an icon; thinking shows its icon and current level without a long prefix. At widths below 360dp or font scale above 1.2, the model takes a full first toolbar row and the remaining controls wrap below, with send at the right. Footer controls provide 48dp targets; the visible 32dp send disc sits inside that target. Header back/new/menu controls use explicit 48dp frames.

Model sheets are limited to 85% of the window height and retain a scrollable list. Capability tags wrap inside a flexible model-text column. Provider filters scroll horizontally. Table rows share computed column widths: tables of one or two columns fill the available reading width; wider tables use content- and font-scale-aware column widths and scroll horizontally. Code blocks scroll horizontally on their own. Neither forces the entire conversation sideways.

Keyboard avoidance uses the native Android height behavior, safe-area insets, and composer measurement. Streaming follows new answer text while the reader remains near the end. Dragging suspends following; remaining at least 60dp from the end exposes a return-to-latest control above the composer. Returning near the end or pressing that control permits following again. Expanding a local process explicitly suspends following and preserves the reading position. Stopping a stream retains the received body.

## Elevation & Depth

The reading surface, user bubble, composer, Markdown containers, and selector sheet are flat: background tone, borders, and whitespace provide separation. The return-to-latest button uses a paper surface and line border without an added shadow. The AI menu is the one raised surface in this scope, using Android elevation 8 and a dimmed backdrop; the shared application's floating AI launcher keeps its existing treatment outside this system.

Selectors use the native modal slide animation; the AI menu uses the native fade. Scrolling to latest is animated only when the user requests it. There is no custom transition duration, easing scale, or decorative reading animation to standardize.

**The Flat Reading Rule.** Keep assistant prose on the page. Use soft tone for code and the question, and a thin bordered white panel for expanded process details. Keep a concrete operation in its own confirmation card.

## Shapes

Rounding belongs to bounded objects rather than every answer. The frontmatter records the actual silhouettes: small capability tags and provider marks, gently curved Markdown/detail containers, a distinct user bubble, a compact composer, and rounded top sheet corners. Send and return-to-latest controls are circular. The sheet radius applies only to its top corners. Borders are thin; row separators use native hairlines, while composer, table perimeter, fields, and operation cards use 1dp outlines.

Quotes use a quiet vertical rule and an indented text block, not a filled quotation card. Tables clip their own perimeter; code uses the soft surface. New decorative shadows, textures, or image-based framing are not part of this implementation.

## Components

### Conversation and Markdown

The assistant answer is selectable native text directly on the page. Headings expose native header roles and links expose link roles. Paragraphs, bold, indented lists, quotations, dividers, tables, inline code, and code blocks remain distinct. Table headers use a soft fill and semibold type; cells share widths across rows. Quotes use secondary ink. The sidecar's HTML/CSS samples are portable visual previews of native components, not shipping web code.

### Composer and buttons

The white outlined composer unifies the draft and conversation settings without centering the model in its available space. The dark send disc changes to a stop icon during generation; an unavailable send action has the disabled fill. Selected search uses the quiet gray icon and a small dot, with no filled control background. Unavailable search adds a dashed outline around its 28dp symbol region and opens an explanatory choice. Thinking displays the current level, with its full value available to accessibility. Configuration changes and new-conversation controls are disabled while streaming as implemented. Pressed quick questions use a soft fill. Do not introduce web hover animation into the native screen; sidecar focus outlines are preview accessibility affordances only.

### Selectors, tags, and navigation

The near-white model/thinking sheet has a handle, close action, searchable model list, provider filter row, and radio semantics for choices. Selected rows use the soft fill and a check. Capability tags are compact descriptive badges, with warnings only for unknown or unavailable capabilities; they wrap rather than truncate the row. The chat header uses native line icons and a tappable title/context stack. The existing stock navigation and button variants remain governed by their shared component source.

### Evidence disclosures

`conversationFlow` preserves the order of independent stored messages. Adjacent evidence stays in one local process block until visible body, notice, error, search offer, or an actionable tool establishes a boundary. Single-message aggregated evidence stays local to that message; the UI does not invent unavailable timing. Tool IDs, search terms, source URLs, and explicit public summaries are deduplicated across a turn; repeated tool records use their latest state. Operation, proposal, memory, and navigation controls remain visible once in the main flow.

Each local process starts collapsed behind an ordinary 13/20 summary and a nearby chevron, with a 48dp minimum target. Expanded details use one paper-white panel with a 1dp line, 12dp radius, and 12dp padding. Existing call arguments appear in a bordered 8dp-radius inset; result output follows as 13/20 monospace. Long input scrolls horizontally. Missing input/output is not replaced by invented JSON. Only explicit OpenAI Responses `summary_text` is public summary content; mixed thinking/reasoning is not exposed. Errors remain visible as a small red outline icon and gray summary, with error details and retry only where supported.

Sources and usage have their own quiet disclosures. Usage shows the model and output count once at the end of the completed turn. A source citation opens its corresponding URL. Capability limitations and pending operations remain directly visible. Parent turn identity and local flow-position keys preserve expansion when a temporary streaming message is saved.

### Operations and memory

Operations are the deliberate card exception: paper surface, thin line border, clear values, validation, and explicit run/cancel actions using the existing app buttons. Result red/green uses shared semantics. Memory changes appear as a compact soft strip with the relevant confirmation or undo controls. Neither an operation nor a memory action executes merely because its visual container is displayed.

### Empty state

An empty configured conversation centers a short prompt and at most three plain, separated quick questions. These questions disappear once conversation content exists. Missing provider configuration uses the existing setup action. Do not keep the empty-state suggestions above a running conversation.

## Do's and Don'ts

### Do:

- **Do** keep assistant answers continuous on the near-white page and preserve the native body/heading hierarchy.
- **Do** contain horizontal overflow inside tables and code, and let capability tags wrap.
- **Do** preserve 48dp chat targets, native font scaling, safe-area padding, keyboard avoidance, stop, and return-to-latest behavior.
- **Do** keep draft and model text left-aligned on the same inset, with compact icon controls and a 32dp send disc inside its 48dp target.
- **Do** keep process disclosures at their actual message position while showing errors and pending confirmations directly.
- **Do** retain shared trading status colors and existing stock-screen components outside the AI scope.

### Don't:

- **Don't** restore a white rounded card or repeated model banner around every assistant answer, or gather all process stages ahead of the answer.
- **Don't** move the desktop reference's sidebar into the phone or claim an independently designed dark theme.
- **Don't** shrink prose or touch targets to make a narrow or enlarged-font layout fit.
- **Don't** center the model, add a large filled search tile, or restore the rejected taller composer.
- **Don't** let a disclosure, streaming update, or model selector steal the reader's chosen scroll position.
- **Don't** invent provider capabilities, execute a pending operation without confirmation, or replace interface icons with decorative imagery.
