# Ask tool (user questions + TUI selectors): research & port plan

Foundational platform context (fork relationship, API contract parity, pi runtime) lives in `BACKGROUND.md` in this folder. Research-only; evidence-indexed.

---

## Part 1 — How omp builds the ask tool

### 1.1 Tool core — `oh-my-pi/packages/coding-agent/src/tools/ask.ts` (1459 lines)

- **Schema** (ask.ts:57-80, omptype): `{ questions: [{ id, question, header?, options: [{label, description?, preview?}], multi?, recommended? }] }`, min 1 question. `.narrow` validation rejects option labels colliding with reserved runtime labels (ask.ts:70-76).
- **Reserved options** (ask.ts:48-55): `"Other (type your own)"` (free-text input, always offered), `"Chat about this"` (redirect to conversation instead of answering), `"Next →"` (paging in multi-question dialogs).
- **Recommended**: `recommended: <index>` marks default; `" (Recommended)"` suffix appended automatically (ask.ts:152, 163-166).
- **Headless fallback** (ask.ts:856-859): no `context.hasUI` → `ToolAbortError("Ask tool requires interactive mode")`. `AskTool.createIf(session)` returns null without UI (ask.ts:831-833).
- **Execution** (ask.ts:848-1105):
  1. Timeout from `ask.timeout` setting (seconds, 0 = disabled) → ms; **disabled in plan mode** (ask.ts:870-874).
  2. Terminal notification `ask.notify` (off/default) via `TERMINAL.sendNotification` (ask.ts:836-846).
  3. TTS: vocalizes the questions when `speech.enabled` (ask.ts:889-891).
  4. **Rich dialog path** when `extensionUi.askDialog` exists (ask.ts:893-979) — `AskDialogComponent`; falls back to the simple path on dialog errors.
  5. **Simple fallback path** — per-question `ui.select` loop with radio/checkbox markers, initial index, left/right navigation between questions, "Other" via `ui.editor` free-text dialog, "Done selecting" for multi (ask.ts:452-706).
- **Timeout semantics** (ask.ts:176-186, 472-544): UI-enforced deadline with `onTimeoutStart`/`onTimeoutReset` re-arming; auto-selects the recommended option on timeout (`getAutoSelectionOnTimeout`); `TIMEOUT_DETECTION_TOLERANCE_MS = 1000` distinguishes UI-enforced timeouts from user Esc.
- **Results** (ask.ts:100-129): `QuestionResult { id, question, options, multi, selectedOptions, customInput?, note?, timedOut? }`; `AskToolDetails` adds `results[]` (multi-part), `chatRedirect`, `questions`.
- **Re-answer** (ask.ts:93-97): `recoverAskQuestions` re-validates a persisted `ask` toolCall's args through the same schema, so `/tree` can re-open the picker with the *original* questions and branch a sibling answer.
- **Concurrency** `"exclusive"` (ask.ts:824): the interactive selector is a single shared UI surface — two concurrent asks would clobber each other.
- **Renderer** `askToolRenderer` (ask.ts:1272+): `mergeCallAndResult: true`; question form + flat marker bullets (radio/checkbox, ask.ts:1208-1210), answer with custom-input continuation rows and `Note:` lines.

### 1.2 The extension-UI surface it depends on (the actual selector machinery)

The tool is thin; the design lives in the UI surface it delegates to:

| Surface | omp file | Size | Features |
|---|---|---|---|
| `ExtensionUISelectItem` | `extensibility/extensions/types.ts:131` | — | `string \| { label, description? }` |
| `ui.select` options | `extensibility/extensions/types.ts:254-257` + `ask.ts:423-450` | — | `initialIndex`, `timeout`, `signal`, `outline`, `onTimeout`, `onTimeoutStart`, `onTimeoutReset`, `onLeft`, `onRight`, `helpText`, `selectionMarker` (radio/checkbox), `checkedIndices`, `markableCount` |
| `ui.editor` | `modes/components/hook-editor.ts` | 213 | free-text dialog (for "Other") with prompt styling |
| `ui.askDialog` | `modes/components/ask-dialog.ts` | 1017 | rich multi-question dialog: tab navigation, headers, option previews, notes, checkbox/radio markers, "Done selecting", timeout countdown, "Chat about this" |
| `HookSelectorComponent` | `modes/components/hook-selector.ts` | 691 | the rich single-picker: descriptions, radio/checkbox markers, checked indices, help text, countdown |
| `ExtensionUiController` | `modes/controllers/extension-ui-controller.ts` | 1250 | wires `select/confirm/input/askDialog/editor/notify/...` to components; collab-guest bridging (`showHookSelector` over the collab protocol) |
| selector helpers | `modes/components/selector-helpers.ts` | 129 | shared rendering helpers |

All are optional (`askDialog?`, `editor?` on `ExtensionUIContext`, ask.ts:893) — RPC/headless surfaces omit them and the tool degrades to the simple select path or aborts.

---

## Part 2 — pi's current state

- **`ExtensionUIContext.select(title, options: string[], opts?: ExtensionUIDialogOptions)`** (pi core/extensions/types.ts:131-133) — **plain strings only**. `ExtensionUIDialogOptions` = `{ signal?, timeout? }` only (types.ts:95-105).
- **`ExtensionSelectorComponent`** (pi modes/interactive/components/extension-selector.ts, ~110 lines) — minimal: string list, ↑↓/enter/esc, optional timeout countdown (`CountdownTimer`), `DynamicBorder`, fixed key-hint footer. No descriptions, no initial index, no markers, no multi-select, no left/right, no timeout callbacks.
- **`input(title, placeholder)`** exists (`ExtensionInputComponent`) — simple text input; **no `editor`** (full free-text dialog), **no `askDialog`**.
- **RPC mode** provides select/confirm/input as JSON-RPC dialogs (pi modes/rpc/rpc-mode.ts:136-140) — ask tool would work headless-RPC with the fallback path, minus free-text "Other" unless `input` suffices.

### Building blocks pi already has (the good news)

- **`SelectList`** in `@earendil-works/pi-tui` (packages/tui/src/components/select-list.ts): already supports `{ label, description? }` items, `→ ` selection marker, primary/secondary column layout with descriptions, scroll indicators, no-match display, filter. Used by pi's own `ThemeSelectorComponent` / `SettingsSelectorComponent` / `ShowImagesSelectorComponent` — **the exact primitive omp's rich selector is built from**.
- `CountdownTimer` (used by ExtensionSelectorComponent), `DynamicBorder`, `keyHint`/`rawKeyHint` — all present.
- `ExtensionUIContext.custom<T>(factory, opts)` (types.ts:196-210) — full custom component with keyboard focus; a ported `AskDialogComponent` could ride on this **without core controller changes**.
- pi's interactive mode already has a `showSelector` dispatcher + focus management (interactive-mode.ts:4354) used by ~10 internal selectors (model, session, settings, tree, trust, user-message…).

---

## Part 3 — Portability assessment

**Verdict: MEDIUM-HIGH, in two tiers.**

### Tier A — tool logic + fallback selector (≈2-3 days) — HIGH
The tool itself (schema, reserved options, recommended suffix, timeout/auto-select, multi-question orchestration, "Other" flow, results, renderer) is portable as-is:
- omptype → typebox (mechanical; `StringEnum` for ops, `Type.Object` for schema, `Type.Union` for `string | {label, description}`).
- `AgentTool` → pi `ToolDefinition` (`execute(toolCallId, params, signal, onUpdate, ctx: ExtensionContext)`), `executionMode: "sequential"` for omp's `concurrency = "exclusive"`.
- The guard `ctx.hasUI` maps to pi's `ExtensionContext.hasUI` (types.ts:313).
- Drop TTS (no pi equivalent; or gate on a future `speech.*`).

Required UI upgrades (small):
1. `ExtensionUISelectItem = string | { label, description? }` in pi's extension types + `ExtensionSelectorComponent` render via `SelectList` (which already handles descriptions).
2. Add `initialIndex` + `selectionMarker`/`checkedIndices`/`markableCount` (radio/checkbox multi) + `onLeft`/`onRight` + `helpText` to `ExtensionUIDialogOptions` and the component — reusing `SelectList`'s existing row rendering.
3. Timeout callbacks (`onTimeout`, `onTimeoutStart`, `onTimeoutReset`) — small extension of the existing `CountdownTimer` wiring.
4. "Other" free-text: port `hook-editor.ts` (213 lines) as an `editor?` member, or reuse `input()` (single-line) as a first cut.

### Tier B — rich `askDialog` (≈+3-5 days) — MEDIUM
`AskDialogComponent` (1017 lines) is the flagship UX: multi-question tabs, headers, previews, notes, markers, paging. Port options:
- **(a) Core-idiomatic (mirror omp):** add optional `askDialog?`/`editor?` to pi's `ExtensionUIContext`; interactive mode implements them, RPC omits → automatic fallback. Matches omp's design exactly; touches core types + interactive mode.
- **(b) Zero-core-change:** the AskTool drives `ctx.ui.custom()` directly with a ported dialog component. No type changes, but the tool then carries TUI-component knowledge (omp keeps that in modes/components) and RPC can't offer it.

Recommend **(a)** — it preserves omp's clean layering and the graceful degradation.

### What's deliberately out of scope
- Collab-guest bridging of `showHookSelector` (omp collab/guest.ts:662) — pi has no collab mode.
- `/tree` re-answer wiring (`recoverAskQuestions` + selector reopen) — port the helper, wire it when pi's tree navigation supports re-running past tool calls.

### Effort summary
| Slice | Effort | Depends on |
|---|---|---|
| Schema + tool core + renderer (typebox) | 1 day | — |
| `ExtensionUISelectItem` + SelectList-based selector upgrades | 1-2 days | pi-tui `SelectList` |
| Timeout callbacks + left/right nav + markers | 0.5-1 day | above |
| `editor` dialog (Other) | 0.5-1 day | hook-editor.ts port |
| Rich `askDialog` component | 3-5 days | AskDialogComponent port + `editor` |
| Settings (`ask.timeout`, `ask.notify`) | 0.5 day | pi SettingsManager |
| **Total** | **≈1-1.5 weeks** | |

---

## Part 4 — Evidence index

### omp
- `packages/coding-agent/src/tools/ask.ts` — schema :57-80, reserved labels :48-55, timeout :176-186/472-544, `AskTool` :771-1105, headless guard :856-859, rich dialog gate :893-979, renderer :1272+
- `packages/coding-agent/src/extensibility/extensions/types.ts:131,254-269` — `ExtensionUISelectItem`, `select`, `askDialog`, `editor`
- `packages/coding-agent/src/modes/components/ask-dialog.ts` (1017) — rich dialog
- `packages/coding-agent/src/modes/components/hook-selector.ts` (691) — rich single picker
- `packages/coding-agent/src/modes/components/hook-editor.ts` (213) — free-text dialog
- `packages/coding-agent/src/modes/controllers/extension-ui-controller.ts` (1250) — UI surface wiring
- `packages/coding-agent/src/modes/components/selector-helpers.ts` (129)
- `packages/coding-agent/src/collab/guest.ts:662` — collab bridging of select

### pi
- `packages/coding-agent/src/core/extensions/types.ts:95-105` — `ExtensionUIDialogOptions` (`signal`, `timeout` only); :131-146 — `select/confirm/input/notify`; :196-210 — `custom()`
- `packages/coding-agent/src/modes/interactive/components/extension-selector.ts` (~110) — minimal string selector
- `packages/coding-agent/src/modes/interactive/interactive-mode.ts:2348-2352,2404-2443` — `ctx.ui.select` wiring, `showExtensionSelector`
- `packages/coding-agent/src/modes/rpc/rpc-mode.ts:136-140` — RPC dialogs
- `packages/tui/src/components/select-list.ts` — `{ label, description? }` list with markers (building block exists)
- `packages/tui/src/components/input.ts`, `packages/coding-agent/src/modes/interactive/components/extension-input.ts` — text input
- `packages/coding-agent/src/modes/interactive/components/countdown-timer.ts`, `dynamic-border.ts`, `keybinding-hints.ts` — present in pi
