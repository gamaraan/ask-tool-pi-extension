# Implementation Plan: `ask` tool extension for pi (port of omp's ask tool)

Port of omp's interactive `ask` tool (`oh-my-pi/packages/coding-agent/src/tools/ask.ts`) to
upstream pi (`pi-mono`) packaged as a standalone, installable pi **extension**, published to
npm as **`@gamaraan/ask-tool`**. It is the full replacement for the now-obsolete
interactive-question extension (and its associated skill) referenced in the
global `AGENTS.md`; once shipped, that old extension and skill are retired in
favor of this one.

This document is the **development plan**, definition-of-done per task, the test strategy used
**during** development, the end-to-end verification used **after** development to confirm every
feature works, and the audit used to confirm the plan was respected. No implementation is written
here — this is the spec the implementation will be checked against.

Evidence base: `ask-tool/ASK-TOOL.md` and `ask-tool/BACKGROUND.md` (research), the omp source in
`oh-my-pi/`, and the pi source in `pi-mono/`. Line references are pinned to the repos at the time
of research; the implementer must re-confirm they still resolve before coding (and update the
plan if they drifted).

---

## 1. Goals & non-goals

### 1.1 Goals

- Ship a pi extension that gives the LLM a tool named `ask` for asking the user one or more
  multiple-choice questions mid-turn, with parity to omp's user-facing behavior:
  - Per-question `options: { label, description?, preview? }`, optional `header`, `multi`,
    `recommended: <index>`.
  - Reserved runtime options always offered: `Other (type your own)` (free text) and
    `Chat about this` (redirect). `Next →` is internal paging.
  - `(Recommended)` suffix auto-appended to the recommended option's label.
  - Timeout with live countdown, auto-selecting the recommended option (or first) on timeout.
  - Multi-question dialogs with back/forward navigation between questions.
  - Rich rendering of the tool call and tool result in the transcript.
- Ship as a **standalone extension package** that loads via pi's extension discovery
  (`pi.extensions` field in `package.json`, see `pi-mono/packages/coding-agent/examples/extensions/with-deps/package.json`),
  with **zero changes to pi core** in v1.
- Degrade gracefully across pi's three run-times: TUI (full rich dialog), RPC (functional
  per-question JSON-RPC dialogs), print/headless (clear error result).
- Include a unit-test suite that runs under pi's existing vitest setup
  (`pi-mono/vitest.base.ts`, `pi-mono/packages/coding-agent/vitest.config.ts`, `"test": "vitest --run"`).

### 1.2 Non-goals (explicitly out of scope for v1)

> **Scope invariant:** This plan adds an extension package. It does **not** modify any file
> under `pi-mono/packages/*/src/` except to add extension test files under `packages/coding-agent/test/`.
> Enforced at PR time by the §12 scope audit.

- **No core pi changes.** Specifically, do NOT modify `ExtensionUIContext.select` to accept
  descriptions/markers, do NOT add `askDialog`/`editor`-style members to core types, and do NOT
  add a settings accessor or plan-mode signal to `ExtensionContext`/`ExtensionAPI`. Those are
  listed in §11 (follow-ups / separate core PRs) and are **not required** for v1 parity.
- **Collab-guest bridging** of the selector (omp `collab/guest.ts:662`) — pi has no collab mode.
- **`/tree` re-answer** (`recoverAskQuestions` + reopening the picker on a past `ask` toolResult
  to branch a sibling answer) — port the pure helper, but full wiring depends on pi tree
  navigation supporting re-run of past tool calls, which it does not yet. Keep the helper as a
  tested exported function; do not wire the UI.
- **TTS** (`vocalizer`) — pi has no equivalent. Drop entirely. Do not gate on `speech.*`.
- **Terminal notifications** (`ask.notify` via `TERMINAL.sendNotification`) — gated on settings
  access pi extensions lack (see §6.1); deferred to the follow-up. v1 uses `ctx.ui.notify(...)`
  where available instead (best effort, not parity).

### 1.3 Success criteria (the plan is "done" when ALL hold)

1. The extension installs into a stock pi checkout via its documented install instructions and
   the `ask` tool is offered to the model with the omp tool description.
2. Every feature in §10 passes the end-to-end acceptance checklist, exercised manually in TUI and
   RPC modes against a real model.
3. `npm run test --workspace @earendil-works/pi-coding-agent` (or the per-package vitest run)
   passes the new unit-test suite with the expected case count, with no regressions in the
   pre-existing suite.
4. `npm run check` (biome + tsgo + pinned-deps + import checks) passes in the pi-mono repo with
   the new package added — no lint/type errors, no forbidden imports.
5. No file under `pi-mono/packages/coding-agent/src/core/` is modified (verified by §12 audit).
6. The plan's task DoD checkboxes (§8) are all checked and every task's verification commands pass.
7. The package is publish-ready as `@gamaraan/ask-tool` on npm: `README.md`, `AGENTS.md`,
   `LICENSE`, and a complete `package.json` exist and `npm publish --dry-run` is clean (T12).
8. The obsolete interactive-question extension and its mandated-use skill are
   retired: zero active references to the old package name remain in the package or `~/.pi/`, and
   the global `AGENTS.md` reference now names `@gamaraan/ask-tool` (verified by §12 audit #9).

---

## 2. Cross-repo facts the implementation depends on (verified during research)

Re-confirm each before coding; if any has drifted, update this section and re-baseline the plan.

| Fact | Source | Used for |
| --- | --- | --- |
| `ToolDefinition` shape (name/label/description/parameters(typebox)/`execute(toolCallId, params, signal, onUpdate, ctx)`/`renderCall`/`renderResult`/`executionMode`/`prepareArguments`) | `pi-mono/packages/coding-agent/src/core/extensions/types.ts:449-497` | tool registration |
| `ExtensionContext` (`ui`, `mode`, `hasUI`, `signal`, `abort()`, no settings, no plan mode) | `types.ts:307-352` | execute ctx |
| `ExtensionUIContext.select(title, options: string[], opts?: ExtensionUIDialogOptions)` — **strings only**; `ExtensionUIDialogOptions = { signal?, timeout? }` only | `types.ts:95-105`, `:131-146` | RPC fallback path |
| `ExtensionUIContext.editor(title, prefill?)` exists in core and interactive mode wires it to `ExtensionEditorComponent` | `types.ts:221-222`, `interactive-mode.ts:2372,2536` | "Other" free text — **reuse, do not port hook-editor** |
| `ExtensionUIContext.custom<T>(factory, opts)` — full custom component with keyboard focus | `types.ts:196-210`, interactive `showExtensionCustom` | TUI rich dialog |
| Interactive `showExtensionSelector` uses `ExtensionSelectorComponent` (minimal string list) | `interactive-mode.ts:2347-2470`, `components/extension-selector.ts` | why we use `custom()` instead |
| RPC mode implements `select/confirm/input/notify/editor` as JSON-RPC dialogs; **`custom()` is a no-op returning `undefined as never`** | `rpc-mode.ts:136-140,228-282` | RPC must use the simple path, never `custom()` |
| Print/no-op UI: `select/...` return `undefined`; `custom: async () => undefined as never` | `core/extensions/runner.ts:236-254` | headless detection |
| `ExtensionAPI.registerTool`, `registerCommand`, `registerFlag`, `getFlag`, `appendEntry`, event hooks | `types.ts:1198-1356` | extension entry; flag-based config |
| Pi extensions have **no settings accessor** and **no core plan-mode signal** (plan mode is itself an example extension `examples/extensions/plan-mode/index.ts`) | `types.ts` (grep: no `getSetting`/`SettingsManager`/`registerSetting`), `examples/extensions/plan-mode/` | drives §6 decisions |
| `SelectList` in `@earendil-works/pi-tui` supports `{ label, description? }` items, `setSelectedIndex`, `onSelect/onCancel/onSelectionChange` | `pi-mono/packages/tui/src/components/select-list.ts` | building block for the rich dialog list |
| `CountdownTimer`, `DynamicBorder`, `keyHint`/`rawKeyHint`, `Editor` all in pi-tui | `modes/interactive/components/{countdown-timer,dynamic-border,keybinding-hints}.ts`, `tui/src/components/...` | dialog chrome |
| Extension test pattern: mock `ExtensionAPI` + `ExtensionContext` with `vi.fn()`, drive the extension's registered tool/command directly | `test/plan-mode-extension.test.ts`, `test/agent-session-dynamic-tools.test.ts` | unit-test design (§9) |
| Vitest: `vitest.base.ts` aliases `@earendil-works/*` to workspace src; per-package config at `packages/coding-agent/vitest.config.ts`; `"test": "vitest --run"` | `pi-mono/vitest.base.ts`, `package.json` | test wiring |

### 2.1 omp source to port (reference, not dependency)

- `oh-my-pi/packages/coding-agent/src/tools/ask.ts` (1459 lines) — schema, reserved labels,
  timeout, `AskTool.execute`, renderer, `recoverAskQuestions`.
- `oh-my-pi/packages/coding-agent/src/modes/components/ask-dialog.ts` (1017) — rich dialog.
- `oh-my-pi/packages/coding-agent/src/modes/components/hook-selector.ts` (691) — single picker.
- `oh-my-pi/packages/coding-agent/src/modes/components/hook-editor.ts` (213) — **NOT ported**
  (pi's `ctx.ui.editor()` replaces it).
- `oh-my-pi/packages/coding-agent/src/modes/components/selector-helpers.ts` (129) — rendering helpers.

---

## 3. Architecture (three execution paths, zero core changes)

The omp tool has two paths: a rich `askDialog` (interactive) and a simple `select` loop (fallback).
Because pi has no `askDialog` and `custom()` is unsupported in RPC/print, the extension itself owns
all three paths inside `execute`:

```
execute(toolCallId, params, signal, onUpdate, ctx):
  guard: questions non-empty, every question has ≥1 option, no reserved-label collision
  if !ctx.hasUI                   → return error result "Ask tool requires interactive mode" (NO throw)   [Path C: headless]
  else if ctx.mode === "tui"     → await ctx.ui.custom(() => new AskDialogComponent(...))             [Path A: rich TUI dialog]
  else                            → run askQuestionsViaSimpleRpc(ctx, params, timeout, signal)         [Path B: RPC fallback]
  normalize results → format text → return AgentToolResult<AskToolDetails>
```

**Path A — TUI rich dialog.** The extension ports omp's `AskDialogComponent` as a pi-tui
`Component` rendered through `ctx.ui.custom(factory, { overlay: true, overlayOptions })`. It owns:
option rows (reusing `SelectList` for descriptions + markers), radio/checkbox markers, multi-select
toggle, `Next →` paging, header chips, optional inline note field, `Other` inline sub-editor (the
`Editor` from pi-tui) **or** fall back to `ctx.ui.editor()` for the custom-input modal, live
`CountdownTimer`, `Chat about this` selection, timeout auto-select, and `done(result)` invocation.

**Path B — RPC fallback.** No `custom()`. Implement the multi-question orchestration loop using
only `ctx.ui.select(title, string[], opts)`, `ctx.ui.input(title, placeholder)` for `Other`, and
`ctx.ui.confirm(...)` for back/forward when there is more than one question. Descriptions and
markers are dropped (RPC `select` is plain strings) — this matches omp's simple-path degradation.
Single-question dialogs map one-to-one to `ctx.ui.select` + an `Other` item.

**Path C — headless/print.** `!ctx.hasUI` (or `mode === "json"|"print"`) → return
`{ content: [{ type: "text", text: "Error: Ask tool requires interactive mode" }], details: {}
, isError: true }` style result. **Do not throw** (omp throws `ToolAbortError`; pi tools return
error results uniformly — see how `examples/extensions/question.ts` returns en error `content`).
Call `ctx.abort()` is **not** appropriate here — there is no agent run to abort in print mode;
returning the error text is the pi-idiomatic handling.

### 3.1 Concurrency

`executionMode: "sequential"` (the pi analogue of omp's `concurrency = "exclusive"`). The shared
UI surface cannot host two dialogs at once; sequential execution prevents two `ask` calls in the
same batch from clobbering each other. Do **not** rely on an in-tool lock — the runtime guarantee
is what makes it safe.

---

## 4. Package layout (the extension package)

The extension is a **new** package, not added into `pi-mono/packages/` (that would couple to the
monorepo release). Ship it as an external npm package that users install, with a `pi.extensions`
manifest entry so pi's loader discovers it. Two acceptable homes; the implementer picks one and
records the choice in §6 (Decision D1):

- **Option α — repo-local `pi-mono/packages/coding-agent/examples/extensions/ask-user-question/`**
  (zero-dep, ts-loaded via jiti, mirrors the existing `examples/extensions/*` shape; great for
  testing inside the monorepo's vitest alias graph).
- **Option β — standalone repo/package** `@gamaraan/ask-tool` with its own
  `package.json`, `dist/`, and a `"pi": { "extensions": ["./dist/index.js"] }` manifest (the
  published-extension shape; this is the package that replaces the obsolete
  interactive-question extension referenced in the global `AGENTS.md`).

Recommended: **β for the deliverable, α-style folder for in-repo unit tests** (vitest config
already aliases the workspace src, so tests under `packages/coding-agent/test/` can import the
extension TS directly). The plan below assumes the extension's TS source lives at
`pi-mono/packages/coding-agent/src/extensions-vendor/ask-user-question/` (a vendor area introduced
for shippable extension packages that want first-class in-repo test coverage) — adjust path to the
chosen home in §6 once D1 is decided.

```text
<extension-root>/
  package.json                     # name "@gamaraan/ask-tool", "pi": { "extensions": ["./dist/index.js"] }
  tsconfig.json                    # extends the monorepo base
  src/
    index.ts                       # default export: (pi: ExtensionAPI) => { registerTool(askTool(pi)); registerFlags/commands }
    ask-tool.ts                    # ToolDefinition (schema(typebox), execute orchestration, renderCall/renderResult)
    schema.ts                      # typebox schemas: OptionItem, QuestionItem, AskParams; reserved-label consts; recoverAskQuestions
    types.ts                       # AskToolDetails, QuestionResult, AskDialogResult (mirrors omp types)
    constants.ts                   # OTHER/CHAT/NEXT reserved labels, RECOMMENDED_SUFFIX, TIMEOUT_DETECTION_TOLERANCE_MS
    format.ts                      # pure: addRecommendedSuffix, stripRecommendedSuffix, getAutoSelectionOnTimeout,
                                   #         formatSingleQuestionResponse, formatQuestionResult
    rpc-fallback.ts                # askQuestionsViaSimpleRpc(ctx, params, {timeout, signal}) — Path B
    dialog/
      ask-dialog-component.ts     # Path A: the rich dialog Component for ctx.ui.custom()
      option-list.ts               # SelectList-backed option rows with radio/checkbox markers, initialIndex, descriptions
      countdown.ts                 # thin wrapper over pi-tui CountdownTimer with onTimeout/onTimeoutStart/onTimeoutReset hooks
      other-input.ts               # inline "Other" editor sub-field (uses pi-tui Editor) + shim to ctx.ui.editor()
      helpers.ts                   # port of selector-helpers.ts (marker bullets, row layout)
    prompts/
      ask.md                       # the tool description served to the LLM (port omp's ask.md; see §6 D4)
  test/
    *.test.ts                      # unit tests (§9)
```

Pinned-dependency policy: pi-mono uses pinned deps and a `check:pinned-deps` script
(`pi-mono/package.json`). If the new package is in-tree, its deps must be pinned and added to the
monorepo `workspaces` only if it has real deps (mirror `examples/extensions/with-deps`). v1 should
have **zero runtime deps** (use only `@earendil-works/pi-*` workspace packages + `typebox`).

---

## 5. Module-by-module port mapping

| Extension module | omp origin | Port action | Notes |
| --- | --- | --- | --- |
| `schema.ts` | `ask.ts:57-80,93-97` | Rewrite `omptype` → `typebox` (`Type.Object`, `StringEnum`/`Type.Array`, `Type.Optional`). Keep the `.narrow` reserved-label check as a manual `validate()` called in `prepareArguments` and in `recoverAskQuestions` (typebox has no `.narrow`; do it imperatively). | `recoverAskQuestions` is a **tested pure export** even though its UI wiring is out of scope. |
| `constants.ts` | `ask.ts:48-55,131-136` | Direct port. `OTHER_OPTION = "Other (type your own)"`, `CHAT_ABOUT_THIS_OPTION = "Chat about this"`, `NEXT_OPTION = "Next →"`, `RECOMMENDED_SUFFIX = " (Recommended)"`, `TIMEOUT_DETECTION_TOLERANCE_MS = 1000`. | Reserved-label collision = an option label equal to any of these three → reject. |
| `format.ts` | `ask.ts:138-173,100-129` + renderer `:1120+` | Direct port of pure helpers; adapt text formatting to whatever markers pi's theme exposes. | Pure functions = the highest-value unit-test surface. |
| `types.ts` | `ask.ts:82-129` | Port `QuestionResult`, `AskToolDetails` (incl. `results?`, `chatRedirect?`, `questions?`, `note?`, `timedOut?`). | Keep field names identical so persisted details are schema-compatible with omp where reasonable. |
| `ask-tool.ts` | `ask.ts:771-1105` + renderer `:1272+` | Translate `AgentTool` → `ToolDefinition`. `execute()` dispatches §3 paths. `executionMode: "sequential"`. `renderCall`/`renderResult` return pi-tui `Text` (see `examples/extensions/question.ts`/`todo.ts` pattern). `prepareArguments` calls `schema.validate`. | Description text loaded from `prompts/ask.md`. Remove TTS, notifications, settings, plan-mode branches (deferred). |
| `rpc-fallback.ts` | `ask.ts:452-706` simple path | Reimplement over `ctx.ui.select`/`input`/`confirm`. Per-question loop with back/forward, `Other` via `ctx.ui.input`, recommended suffix appended to the option string before passing to `select`, timeout via `ExtensionUIDialogOptions.timeout`, auto-select on `undefined` return when a timeout was active. | This is the only path RPC/print-with-UI uses. |
| `dialog/ask-dialog-component.ts` | `modes/components/ask-dialog.ts` | Port to pi-tui `Component` interface (`render(width): string[]`, `invalidate()`, `handleInput(data)`, `dispose()`). Drive from `ctx.ui.custom((tui, theme, kb, done) => ...)`. Tabs/questions via internal index + `Next →`/back; multi via checkbox markers; header chips; `Chat about this`; countdown in title. `done(richResult | null)`. | Largest module. Implement in slices (§8 Task T7). |
| `dialog/option-list.ts` | `hook-selector.ts` + `selector-helpers.ts` | `SelectList`-backed rows with `→`/`☑`/radio markers, `initialIndex`, descriptions, scroll. | Reuse pi-tui `SelectList`; do not re-roll layout. |
| `dialog/countdown.ts` | `ask.ts:176-186,472-544` + `countdown-timer.ts` | Wrap pi-tui `CountdownTimer`; expose `onTimeout`/`onTimeoutStart`/`onTimeoutReset` re-arm hooks (omp semantics). | `TIMEOUT_DETECTION_TOLERANCE_MS` lives here. |
| `dialog/other-input.ts` | `hook-editor.ts` | Inline `Editor` sub-field for the dialog; ALSO provide a `viaEditorApi(ctx)` shim that calls `ctx.ui.editor()` for Path B/"Other". | Do NOT port hook-editor as a standalone dialog; pi's `editor()` already covers the modal case. |
| `index.ts` | — | `export default function (pi: ExtensionAPI) { pi.registerTool(defineTool(askTool)); registerFlags(pi); }` | Also re-export `recoverAskQuestions` for future `/tree` use. |
| `prompts/ask.md` | omp `prompts/tools/ask.md` | Copy verbatim, then strip omp-only instructions (TTS, notifications) and align reserved-label wording to exactly the constants in `constants.ts`. | A protocol-level test asserts the served description contains the reserved-label phrases verbatim (§9). |

---

## 6. Open decisions (record answers here before implementation starts)

These are non-trivial choices surfaced by research. Per the global guardrail they would normally be
asked interactively, but because this deliverable is a plan (no implementation now), they are
recorded as decisions to be confirmed at implementation kickoff.

- **D1 — Package home.** α (in-repo `examples/extensions/ask-user-question/`) vs β (standalone
  `@gamaraan/ask-tool` package) vs the hybrid in §4. Recommend **hybrid**: standalone
  package, with its TS sources also reachable from the monorepo test runner via a `src/extensions-vendor/`
  mirror so the vitest alias graph covers them. The npm package name is fixed: `@gamaraan/ask-tool`
  (this **replaces** the obsolete interactive-question extension; do not revive that name).
  Confirm before Task T1.
- **D2 — Timeout config surface.** pi extensions cannot read `SettingsManager`. Options:
  (a) register CLI flags `--ask-timeout <seconds>` + `--ask-notify <off|on>` via `pi.registerFlag`
  (works in all modes; user sets per-invocation);
  (b) read env `PI_ASK_TIMEOUT_SECONDS` / `PI_ASK_NOTIFY`;
  (c) hardcode `timeout = 0` (disabled) for v1 and defer config to the core-settings follow-up.
  Recommend **(a)+(b) combined**: flags win over env, env wins over hardcoded default `0` (timeout
  off — safest; no surprise auto-selects). `ask.notify` is out of scope for v1 behavior (no
  `TERMINAL.sendNotification` port); keep only the flag plumbing so a future patch can honor it.
  Confirm before Task T5.
- **D3 — Plan-mode behavior.** No core plan-mode signal is exposed to extensions. Options:
  (a) ignore plan mode in v1 — timeout behaves uniformly (recommended; matches "no setting/signal");
  (b) detect plan mode by inspecting active tools for plan-mode tool names (fragile, couples to
  the plan-mode example). Recommend **(a)**. Confirm before Task T5.
- **D4 — Tool description source.** Use omp `ask.md` verbatim (copyright/authorship) or rewrite.
  Recommend **port with attribution stripped from prompts and noted in the package README**, since
  omp is a fork of pi by a pi contributor (see `BACKGROUND.md` §1). Confirm before Task T2.
- **D5 — `Other` inline vs modal in Path A.** omp's `AskDialogComponent` keeps `Other` inline
  within the dialog. pi's `ctx.ui.editor()` is already wired and would push a modal. Options:
  (a) inline `Editor` sub-field inside the dialog (parity, more code);
  (b) exit the custom component and call `ctx.ui.editor()` (simpler, loses focus continuity).
  Recommend **(a)** for parity, with **(b)** as the documented fallback if (a) proves unstable.
  Confirm before Task T7.
- **D6 — License.** The package `LICENSE` file (T12). Recommend **match pi's own LICENSE**
  for consistency (same permissiveness, same holder pattern), so the fork→port lineage is
  unambiguous. Confirm before Task T12.

---

## 7. Concurrency, error, and abort semantics (must match omp)

- **Abort/Esc:** user Esc in the dialog → `done(null)` → `execute` returns a "cancelled" text
  result with `details: {}` and calls `ctx.abort()` (because the turn was user-cancelled mid-run,
  exactly like omp's `context.abort(); throw ToolAbortError`). In pi the idiomatic equivalent is
  `ctx.abort()` + return a result (do not throw — pi turns `isError`-flagged results into the
  right transcript state; verify against an existing tool that aborts).
- **Signal abort:** if `ctx.signal?.aborted` before show, resolve `null` (cancelled), same as above.
  Pass `signal` into `ExtensionUIDialogOptions.signal` for RPC and into the custom component's
  countdown for TUI so external aborts close the dialog.
- **Timeout auto-select:** when the countdown fires and `recommended` is set, the result's
  `selectedOptions = [options[recommended].label]` (else `[options[0].label]`), `timedOut: true`.
  Do **not** call `ctx.abort()` on timeout — the model should receive a real answer.
- **Timeout disabled in Path A only when configured `0`** (per D2). No plan-mode carve-out (D3).
- **Empty/corrupt args:** `prepareArguments` rejects; `execute` returns an error result (no throw).
- **Mismatched result count** from the dialog (defensive): return an error result rather than
  crashing, with `details: {}`.

---

## 8. Task breakdown with Definition of Done & per-task verification

Each task is independently reviewable. DoD is binary; the verification command is what proves it.

### T1 — Scaffold package + manifest + tsconfig

**DoD:**

- Package dir created at the home chosen in D1 with `package.json` (`name`, `version`, `type:
  module`, `"pi": { "extensions": ["./dist/index.js"] }`), `tsconfig.json` extending the monorepo
  base, empty `src/index.ts` exporting a no-op `default`.
- If in-monorepo: added to `workspaces` only if it has deps (it does not in v1), and `npm install`
  succeeds without lockfile churn beyond the new package.
**Verify:**

```bash
cd pi-mono && tsgo --noEmit -p <pkg>/tsconfig.json
# loader can discover it:
node -e "import('./packages/coding-agent/src/core/extensions/loader.ts').then(async m=>{ /* create tmp extensions dir, write a shim that re-exports the pkg index, run discoverAndLoadExtensions, expect 1 extension and 0 errors */ })"
```

- Lint clean: `npx biome check <pkg>` (or `npm run check` once wired).

### T2 — `prompts/ask.md` + tool description plumbing

**DoD:** `prompts/ask.md` imported via `import ... with { type: "text" }` (pi already uses this — see
`ask-tool.ts` omp import); `askTool.description` renders it; no omp-only paragraphs (TTS/notify).
**Verify:** unit test asserts `askTool.description` contains each reserved-label string verbatim and
does not contain the words `vocaliz`, `speech`, `notification`.

### T3 — `constants.ts` + `schema.ts` + `types.ts` + `recoverAskQuestions`

**DoD:** typebox schemas compile; `validate(params)` accepts valid input and rejects: empty
questions, a question with zero options, and a question whose option label equals any reserved
label. `recoverAskQuestions` returns `undefined` for malformed persisted args and the questions for
valid args.
**Verify:** unit tests in `test/schema.test.ts` (see §9) — count ≥ 8 cases, all green:

```bash
npx vitest run test/<pkg>/schema.test.ts
```

### T4 — `format.ts` (pure helpers)

**DoD:** `addRecommendedSuffix`, `stripRecommendedSuffix`, `getAutoSelectionOnTimeout`,
`formatSingleQuestionResponse`, `formatQuestionResult` match omp output byte-for-byte for the
golden cases. `getAutoSelectionOnTimeout([])` returns `[]`; out-of-range `recommended` falls back to
first option.
**Verify:** `test/format.test.ts` with golden snapshots (≥ 10 cases) green:

```bash
npx vitest run test/<pkg>/format.test.ts
```

### T5 — `ask-tool.ts` skeleton: schema wiring, dispatch shell, flags/env config (D2/D3)

**DoD:** `defineTool(askTool)` registered with `executionMode: "sequential"`, `prepareArguments`
calls `schema.validate`, `execute` dispatches to Path A/B/C stubs (stubs return fixed results).
Timeout resolved from flag→env→default(0). Plan-mode carve-out NOT implemented (D3). `renderCall`
and `renderResult` produce a `Text` (can be minimal stub here; fleshed out in T9).
**Verify:**

- Unit test in `test/ask-tool.test.ts` calls `askTool.execute(...)` with a **mock ctx** (`mode:"print"`,
  `hasUI:false`) and asserts the Path-C error result (no throw).
- Another case with `mode:"rpc"`, `hasUI:true`, a stubbed `ui` whose `select` resolves a fixed
  string, asserts the stubbed RPC path returns the expected result text.

```bash
npx vitest run test/<pkg>/ask-tool.test.ts
```

### T6 — `rpc-fallback.ts` (Path B) — full multi-question loop

**DoD:**

- Single question → one `ctx.ui.select` with `[...userOptions, OTHER_OPTION]` (recommended suffix
  pre-merged into the label strings); `Other` selection → `ctx.ui.input`; `Chat about this` handled
  only if explicitly added (RPC path does NOT add `Chat about this` by default — that is a rich-dialog
  affordance; document this divergence in the README and in a test).
- Multi-question → loop with back/forward via `ctx.ui.confirm` ("Back to previous?" / "Answer next?")
  OR simpler: enumerate questions one at a time with a `Next →` confirm gate; final question on
  confirm submits. Timeout honored via `opts.timeout`; on `undefined` return + active timeout →
  auto-select. Esc (`undefined` with no timeout) → cancel result + `ctx.abort()`.
**Verify:** `test/rpc-fallback.test.ts` with a mock `ui` (`vi.fn()` on `select`/`input`/`confirm`)
driving scripted answers for: single select, Other custom input, timeout auto-select, multi-q
back navigation, cancel/Esc. ≥ 7 cases green.

### T7 — `dialog/ask-dialog-component.ts` (Path A) — sliced

Port omp's `AskDialogComponent` to a pi-tui `Component`. Implement and verify **in this order**:

- **T7.1 option-list + render:** `SelectList`-backed rows, descriptions, `initialIndex`, radio
  marker for single / checkbox for `multi`, scroll. `render(width)` returns the dialog lines.
  Verify: snapshot of `render()` output for a 5-option question with descriptions.
- **T7.2 input handling:** ↑↓ nav, Enter select/toggle (multi), `Other` row → inline editor
  (D5 option a), `Chat about this` row, Esc → `done(null)`. Verify: a fake-input driver feeds
  key codes and asserts `done` payload.
- **T7.3 multi-question paging:** `Next →` row advances, back key returns to previous question
  pre-filled with the prior answer; progress chip `i/n` in title. Verify: scripted Q1→Q2→back→Q1.
- **T7.4 countdown + auto-select:** `CountdownTimer` in title; on fire, `done` with
  `getAutoSelectionOnTimeout`, `timedOut:true`; re-arm hooks `onTimeoutStart/onTimeoutReset` exist.
  `TIMEOUT_DETECTION_TOLERANCE_MS` distinguishes UI-timeout `undefined` from Esc. Verify: inject a
  20ms timeout and assert timeout result; inject Esc just after show and assert `null`.
- **T7.5 header chips + note field (optional):** render `question.header` as a chip; optional inline
  note (skip if low value — mark optional in README). Verify: snapshot with header.
- **T7.6 integration into `ask-tool.ts` Path A:** `ctx.ui.custom((tui, theme, kb, done) => new
  AskDialogComponent(..., done))`; map rich result → `QuestionResult[]`; `chatRedirect` handling.
  Verify: unit test with a mock `ctx.ui.custom` that invokes the factory, simulates `done(result)`,
  and asserts the returned `AgentToolResult`.

Each sub-task ships its own test file and must pass before the next starts.

### T8 — `index.ts` wiring + flags/env (D2) + re-export `recoverAskQuestions`

**DoD:** default export registers the tool + flags; `recoverAskQuestions` re-exported; extension
loads under `discoverAndLoadExtensions` in a temp extensions dir (mirrors
`test/extensions-discovery.test.ts`).
**Verify:**

```bash
cd pi-mono/packages/coding-agent && npx vitest run test/extensions-discovery.test.ts
# plus a new test/extensions-ask-user-question-discovery.test.ts that drops the pkg into a tmp
# extensions dir and asserts the 'ask' tool name appears in pi.getAllTools()
```

### T9 — `renderCall` / `renderResult` polish (parity with omp renderer)

**DoD:** `renderCall` shows the question form + flat option marker bullets; `renderResult` shows
the selected answer(s) with `(Recommended)` stripped for display where appropriate, `Note:` line
when `note` present, `timedOut` indicator, and the `Chat about this` redirect result.
**Verify:** `test/ask-render.test.ts` snapshots `renderCall`/`renderResult` for: single select,
multi select with custom Other input, timeout result, chat redirect, multi-question results.
`new Text(..., 0, 0)` component shape matches the pattern in `examples/extensions/question.ts`.

### T10 — Documentation (README + install instructions)

**DoD:** README documents: install, enable, the three run-time behaviors and their feature deltas
(RPC lacks `Chat about this`), the flag/env config (D2), the deferral of `ask.notify`/plan-mode,
and how to run the tests. `<pkg>/package.json` `files`/`exports`/`pi` manifest correct.
**Verify:** `npm pack --dry-run` lists the right files; manual install into a fresh `~/.pi/agent/extensions/`
directory and `pi` picks it up (instructions followed by a human OR a scripted smoke test in CI).

### T11 — Repo hygiene + gates

**DoD:** `npm run check` passes in pi-mono with the new package; `npm run test --workspace
@earendil-works/pi-coding-agent` green; no modifications under `packages/coding-agent/src/core/`
(see §12 audit); CONTRIBUTING/SECURITY impact noted if any.
**Verify:** the commands in §6 success criteria #3, #4, #5.

### T12 — Publish-readiness: README, AGENTS.md, LICENSE, package.json + retire the old skill

**Context:** Once implementation is finished, this extension is published to npm as
`@gamaraan/ask-tool`. It is the intended full replacement for the obsolete
interactive-question extension and its associated skill referenced in the global
`AGENTS.md`. This task packages the project for publishing and retires that old skill.

**DoD:**

- **`README.md`** at the package root explaining the functionality end-to-end: what the `ask`
  tool does, the three run-time behaviors and their feature deltas (TUI rich dialog vs RPC
  per-question fallback vs print/headless error), the reserved runtime options
  (`Other (type your own)`, `Chat about this`, `Next →`), `recommended`/`(Recommended)` suffix,
  `multi`, timeout auto-select, multi-question paging, the `--ask-timeout` / `PI_ASK_TIMEOUT_SECONDS`
  config (per D2), install + enable instructions (`pi.extensions` discovery or `~/.pi/agent/extensions/`),
  the explicit statement that this **replaces** the obsolete interactive-question
  extension, and how to run
  the tests.
- **`AGENTS.md`** at the package root guiding future development effort: project layout map,
  the three-path architecture summary (§3), the no-core-changes scope invariant (§1.2), the
  build/test/check commands, the typebox-not-omptype constraint, the reserved-label contract, the
  skill-replacement policy (below), and the §14 follow-ups list as the roadmap.
- **`LICENSE`** file with the license chosen for the package (record the choice as decision **D6**
  in §6; default recommendation: match pi's own LICENSE for consistency — confirm before T12).
- **`package.json`** finalized for npm publishing of `@gamaraan/ask-tool`: correct `name`, `version`,
  `description`, `type: module`, `main`/`module`/`exports` (incl. the `pi` manifest subpath if used),
  `"pi": { "extensions": ["./dist/index.js"] }`, `files` allowlisting `dist/` + `prompts/` +
  `README.md` + `LICENSE` + `AGENTS.md`, `engines`, `peerDependencies` on the consumed
  `@earendil-works/pi-*` packages (declared also as devDeps for the workspace build), `scripts`
  (`build`, `test`, `prepublishOnly`), `repository`, `author`, `license`, `keywords`. Zero runtime
  `dependencies` (per §4). Versioning starts at `0.1.0`.
- **Skill retirement:** the skill that mandated use of the old interactive-question
  extension is now obsolete. Refactor that skill to point at `@gamaraan/ask-tool` instead (update
  the extension/package name it instructs agents to use, and the tool name if the old skill named
  the old tool). If the skill is no longer needed as a standalone artifact, mark it retired. The
  global `AGENTS.md` reference to the old extension is updated in the same change
  to name `@gamaraan/ask-tool`. Record the skill edit here as a checkbox, not as prose procrastinated
  to “later”.

**Verify:**

- `npm pack --dry-run` lists exactly the allowlisted files and the tarball name is
  `gamaraan-ask-tool-<version>.tgz`.
- `npm publish --dry-run` succeeds (auth aside) with no warnings about missing `repository`/
  `license`/`description`.
- A fresh install of the tarball into a temp dir + enabling it in `~/.pi/agent/extensions/` makes
  the `ask` tool appear (re-run the §10.2 F1 check).
- The old-skill refactor checkbox is checked and a case-insensitive grep for the
  old package name over `~/.pi/` in the
  user environment returns no remaining live references (only, optionally, a retire note).
- A case-insensitive grep for the old package name over `<package-root>/` returns
  **zero** matches.
- README, AGENTS.md, LICENSE, and package.json all pass `npm run check` lint rules.

---

## 9. Unit-testing strategy (during development)

### 9.1 Framework & wiring

- Use the existing vitest config (`pi-mono/vitest.base.ts` aliases, `packages/coding-agent/vitest.config.ts`).
- Pattern after `test/plan-mode-extension.test.ts`: a `setup()` helper that builds a mock
  `ExtensionAPI` (with `vi.fn()` for `registerTool`/`registerCommand`/`registerFlag`/`getFlag`) and
  a mock `ExtensionContext` (`mode`, `hasUI`, `ui` object with `vi.fn()` `select`/`input`/`confirm`/
  `custom`/`editor`/`notify`, plus `abort`, `signal`). The helper captures the registered
  `ToolDefinition` so tests can call its `execute`/`renderCall`/`renderResult` directly.
- Place tests under `packages/coding-agent/test/` if hybrid, or under the package's own `test/`
  with a small vitest config that extends the monorepo base aliases. Prefer in-tree to reuse the
  alias graph — decision recorded in §6 D1.

### 9.2 Required test files and minimum cases (the "during" gate)

| File | Covers | Min cases |
| --- | --- | --- |
| `schema.test.ts` | validate + recoverAskQuestions | 8: valid single; valid multi; empty questions; zero options; reserved-label collision (each of 3 labels); recommended out of range ignored; recoverAskQuestions valid; recoverAskQuestions malformed → undefined |
| `format.test.ts` | pure helpers | 10: addRecommendedSuffix (with/without suffix, out of range, negative); stripRecommendedSuffix; getAutoSelectionOnTimeout (empty, has recommended, no recommended, range); formatSingleQuestionResponse (selected, custom, timedOut, note); formatQuestionResult (multi) |
| `ask-tool.test.ts` | execute dispatch + flags/env + concurrency | 7: Path C error (print); Path B stub happy; Path B cancel → abort; flag overrides env; env overrides default; default timeout=0 (disabled); executionMode value |
| `rpc-fallback.test.ts` | Path B loop | 7: single select; Other → input; timeout auto-select; multi-q forward; multi-q back; multi-q Esc abort; recommended suffix appears in select options |
| `ask-dialog-component.test.ts` (T7 subs) | Path A component | see T7 sub-verifications; ≥ 12 (render snapshot, nav, toggle multi, Other inline, Chat redirect, paging forward/back, countdown timeout, Esc-only, tolerance window, header chip, done mapping, chatRedirect result) |
| `ask-render.test.ts` | renderCall/renderResult | 5 (see T9) |
| `extensions-ask-user-question-discovery.test.ts` | loader end-to-end | 2: discovery succeeds, `ask` tool name appears in `getAllTools()` |

A test-count assertion is added to the suite runner (or a CI grep) so "all features implemented"
is provable by number, not just opinion. Minimum: **51+ cases total**.

### 9.3 Mocking the `ctx.ui.custom` rendering for Path A unit tests

- `ctx.ui.custom = async (factory) => { const comp = await factory(fakeTui, fakeTheme, fakeKb, done); /* drive comp.handleInput(...) with synthetic key codes; finally call done(result) */ return result; }`.
- `fakeTui.requestRender` is a `vi.fn()`. `fakeTheme` is a thin stub where `theme.fg(c, t) => t`
  and `theme.bold = s => s` so snapshots are ANSI-free and stable.
- Synthetic keys via omp's `Key.*` constants mapped to the same escape sequences pi-tui uses
  (`Key.up`/`Key.down`/`Key.enter`/`Key.escape` from `@earendil-works/pi-tui`, same as
  `examples/extensions/question.ts` uses `matchesKey`).

### 9.4 What is deliberately NOT unit-tested

- Real terminal rendering (covered by manual §10) — pi-tui `Component` tests are snapshot-of-`render`
  only; no PTY.
- A live model call — `execute` is always called directly with crafted params.

---

## 10. End-to-end verification (after implementation — the "is it fully working" gate)

These are the manual + scripted checks that confirm **all features** are properly implemented
according to this plan. Run them against a real pi built from the branch. Record results in the PR
description; the PR is not mergeable without a green table.

### 10.1 Setup

- Build pi from `pi-mono` (`npm run build`), build the extension package, install/enable it
  (`pi.extensions` discovery or copy into `~/.pi/agent/extensions/`).
- Launch `pi` in TUI mode against any model and in RPC mode (`pi rpc` or the configured RPC entry)
  against the same model.
- Use a model prompt that reliably emits an `ask` call, e.g.:
  *“Before you start, use the ask tool: ask me two questions — which storage backend (SQLite,
  PostgreSQL, MongoDB) and which auth method (JWT, OAuth2, Session cookies); recommend SQLite and
  JWT. Options should include short descriptions.”*

### 10.2 Feature acceptance checklist (each row: TUI | RPC)

| # | Feature | How to verify | TUI | RPC |
| --- | --- | --- | --- | --- |
| F1 | Tool is offered to the model with the omp description | Ask the model to “list the tools you have”; `ask` appears with the ported description and reserved-option wording | ☐ | ☐ |
| F2 | Single question renders, ↑↓ navigates, Enter selects | Prompt a single-question ask; navigate, select | ☐ | ☐ |
| F3 | `Other (type your own)` lets the user type a custom answer and the result records it | Select Other, type, submit | ☐ | ☐ |
| F4 | Recommended option shows `(Recommended)` and is the default cursor position | Inspect the rendered options | ☐ | ☐ |
| F5 | Timeout (set `--ask-timeout 5`) auto-selects the recommended option after 5s and marks `timedOut` | Wait without touching keys; observe auto-select + transcript | ☐ | ☐ |
| F6 | Timeout disabled (`--ask-timeout 0`) never auto-selects | Repeat F5 with 0; no countdown | ☐ | ☐ |
| F7 | Multiselect (`multi:true`) toggles rows with checkbox markers and submits the set | Prompt a multi question; toggle ≥2; submit | ☐ | ☐ |
| F8 | Multi-question dialog: `Next →` advances, back returns to the previous question with prior answer pre-filled | Prompt two questions; go next, back | ☐ | ☐ |
| F9 | Esc cancels the ask and the agent turn aborts cleanly (no crashed transcript) | Press Esc; transcript showsCancelled + turn ends | ☐ | ☐ |
| F10 | `Chat about this` (TUI only) returns a redirect result and the agent continues conversationally | Select `Chat about this`; agent replies conversationally | ☐ | N/A |
| F11 | External `AbortSignal` closes an in-flight dialog (stop button) | Trigger stop while dialog is open | ☐ | ☐ |
| F12 | Two `ask` calls batched together execute sequentially, never concurrently | Ask the model to call ask twice in one turn; observe no double-dialog | ☐ | ☐ |
| F13 | Headless/print: returns an error result, never throws, never opens a dialog | Run in print mode (`pi print -p "<prompt that asks>"`); see error text in output, no crash | N/A | N/A |
| F14 | `renderCall` shows question form + option bullets; `renderResult` shows the answer (and `Note:`/`timedOut` when set) | Inspect the transcript before and after | ☐ | ☐ |
| F15 | Persistence: after answering, navigating the session tree shows the ask tool result with intact `details` | `/tree` to a past ask result; reopen/inspect | ☐ | ☐ |
| F16 | `recoverAskQuestions` round-trips persisted args | Unit test only (§9) — already covered; re-confirm green | ✅ | ✅ |

Each cell must be ☑ or explicitly N/A with a one-line rationale. Five or more empty ☐ blocks merge.

### 10.3 Regression sweep

- Run the **full pre-existing** coding-agent test suite before and after; diff the pass count.
  Required: no new failures; the **only** delta is the new test files passing.

  ```bash
  cd pi-mono/packages/coding-agent && npx vitest run
  ```

- `npm run check` (biome + tsgo + pinned-deps + import checks + browser-smoke) green.
- `npm run build` succeeds (extension `dist/` emitted with `index.js` + `prompts/ask.md`).

### 10.4 Cross-mode feature-delta acceptance

- The README's "Feature matrix" table (TUI/RPC/print) is **confirmed accurate** by the F1–F16 run:
  specifically `Chat about this` = TUI-only, descriptions/markers = TUI-only, per-question paging =
  both, error-in-print = yes. Any mismatch → fix the code or fix the README; no silent divergence.

---

## 11. How to confirm the plan was respected (implementation audit)

Run this audit at PR time, before asking the user to merge. Every item must hold.

1. **Scope audit — no core changes.**

   ```bash
   cd pi-mono && git diff --name-only main...HEAD -- packages/coding-agent/src/core/
   ```

   Expected: **no output**. If non-empty, the PR violated §1.2 (no core changes) and must be
   reworked or the affected core change must be split into a separate PR with its own plan.

2. **Task-DoD audit — every §8 task has a checked DoD and a green verification.**
   The PR description lists T1–T12 each with the verification command's actual output (test
   counts / snapshot names). Section §8's checkboxes are all ☑. T12's publish-readiness
   checkboxes (README, AGENTS.md, LICENSE, package.json, old-skill retirement) are all ☑.

3. **Test-count audit — §9.2 minimum met.**

   ```bash
   cd pi-mono/packages/coding-agent && npx vitest run test/<pkg>/ 2>&1 | tail -5
   ```

   Total passing cases ≥ 51 (§9.2 floor), broken down by file as listed. A grep asserts each
   required test file exists:

   ```bash
   ls test/<pkg>/{schema,format,ask-tool,rpc-fallback,ask-dialog-component,ask-render,extensions-ask-user-question-discovery}.test.ts
   ```

4. **Feature audit — §10.2 F1–F16 table is fully ☑/N/A in the PR description.**

5. **Decisions audit — every §6 D1–D6 has a recorded answer in the PR description** and the code
   reflects it (e.g. D2: `registerFlag` calls present; D3: no plan-mode branch in `ask-tool.ts`;
   D5: inline editor present in the dialog; D6: LICENSE matches the chosen license).

6. **Non-goals audit — no forbidden code:**

   ```bash
   grep -RInE "vocaliz|speech\.|TERMINAL\.sendNotification|getPlanModeState|SettingsManager|getSetting\(" <pkg>/src
   ```

   Expected: no matches (the `ask.notify`/plan-mode/speech features are deferred — §1.2).

7. **Dependency audit — zero runtime deps unioned into the package, and pinned if any are added:**

   ```bash
   node -e "const p=require('<pkg>/package.json'); console.log(JSON.stringify(p.dependencies||{}));"
   ```

   Required output: `{}` for v1.

8. **Loader audit — discovery test green** (T8 verify) and a fresh-install smoke (T10) works.
9. **Naming / old-extension-replacement audit — the package is `@gamaraan/ask-tool`, with zero
   live references to the obsolete interactive-question extension:**

   Run a case-insensitive grep for the retired extension's package name across
   `<package-root>/` and `~/.pi/`.

   Expected inside `<package-root>/`: zero matches. Inside `~/.pi/`: only the retired-skill
   note (if any), never an active instruction to install/require the old name. The skill that
   mandated the old extension has been refactored to `@gamaraan/ask-tool` (or marked retired),
   and the global `AGENTS.md` reference now names `@gamaraan/ask-tool`.

If all nine pass, the plan was respected and the feature is fully working.

---

## 12. Risk register

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| pi `ctx.ui.custom` factory signature/keys differ from omp's `ExtensionUIContext` | M | H | Anchored to `types.ts:196-210` + `examples/extensions/question.ts`; T7.1 snapshot first. |
| Synthetic-key handling in tests doesn't match what a real terminal sends → false negatives | M | M | Reuse `matchesKey`/`Key.*` exactly as `examples/extensions/question.ts` does; cross-check one case in a real PTY at §10. |
| omap's `AskDialogComponent` is 1017 lines — port underestimates effort | H | M | Sliced in T7.1–T7.6, each independently shippable/mergeable; T7.5 note is optional. |
| Timeout tolerance window (`TIMEOUT_DETECTION_TOLERANCE_MS`) is flaky on slow CI | M | L | Use 20ms+ in tests, never 1ms; assertive but loose timing bounds. |
| Flag/env config (D2) conflicts with future core-settings PR | L | L | Keep the config surface narrow and documented; the follow-up PR can supersede flags with `getSetting`. |
| `executionMode: "sequential"` semantics differ from omp `concurrency:"exclusive"` | L | M | Confirmed equivalent in `BACKGROUND.md` §3; T5 unit test asserts the value. |
| pi-tui `SelectList` lacks a primitive omp relied on (e.g. `markableCount`/`checkedIndices`) | M | L | `option-list.ts` renders markers itself; `SelectList` only provides row geometry. Fallback to hand-rolled rows if needed. |
| Standalone package can't resolve `@earendil-works/pi-*` as peerDeps cleanly | M | M | Declare them `peerDependencies` + `devDependencies` (workspace) in `package.json`; confirm `npm pack` + install into a clean dir. |
| The old interactive-question skill/AGENTS.md reference is missed during retirement | M | L | T12 has an explicit checklist for the skill refactor + §12 audit #9 greps for leftover old-name references in both the package and `~/.pi/`. |
| Renaming drift: a stale reference to the retired extension survives in a test fixture or doc | L | L | The §12 audit #9 grep runs over the package root; add it to CI alongside `check:ts-imports`. |

---

## 13. Effort estimate

| Slice | Effort | Task |
| --- | --- | --- |
| Scaffold + prompts + constants/schema/types/recover + format | 1 day | T1–T4 |
| Tool skeleton + flags/env + RPC fallback | 1–1.5 days | T5–T6 |
| Rich TUI dialog (Path A), sliced | 3–5 days | T7.1–T7.6 |
| Wiring + render polish + docs + hygiene | 1 day | T8–T11 |
| Tests (interleaved with slices above) | ~2 days total throughout | §9 |
| End-to-end acceptance (§10) | 0.5 day | §10 |
| **Total** | **≈1.5 weeks** | |

Matches the research estimate in `ASK-TOOL.md` Part 3 (Tier A+B ≈ 1–1.5 weeks), with the savings
from **reusing pi's existing `ctx.ui.editor()`** (no `hook-editor.ts` port) and the cost from
**packaging + testing** that an in-tree omp feature doesn't carry.

---

## 14. Follow-ups (separate PRs, intentionally NOT this plan)

1. Core `ExtensionUIContext.select` upgrade to `ExtensionUISelectItem = string | { label,
   description? }` + `ExtensionSelectorComponent` via `SelectList` (would let the RPC path show
   descriptions and let the dialog lean on core chrome). Separate core PR; this extension must not
   depend on it.
2. Settings accessor on `ExtensionAPI`/`ExtensionContext` so `ask.timeout`/`ask.notify` can be real
   settings; then fold D2 flags into settings.
3. `ask.notify` via a pi terminal-notification primitive (port `TERMINAL.sendNotification`).
4. Plan-mode signal exposed to extensions (so D3 can be revisited).
5. `/tree` re-answer wiring once pi supports re-running past tool calls with sibling results
   (`recoverAskQuestions` is already exported and tested for this).
6. Collab-guest bridging if pi gains a collab mode.

---

*This plan is the specification. Implementation starts only after §6 D1–D5 are confirmed and T1
is authorized.*
