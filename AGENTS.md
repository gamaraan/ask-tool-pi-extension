# AGENTS.md — @gamaraan/ask-tool

Guidance for future development of this repository. The authoritative spec is
`docs/IMPLEMENTATION-PLAN.md` (research in `docs/ASK-TOOL.md` /
`docs/BACKGROUND.md`); this file is the operating manual.

## What this is

A standalone pi extension package that ports OMP's `ask` tool
(`oh-my-pi/packages/coding-agent/src/tools/ask.ts` + `modes/components/ask-dialog.ts`)
to upstream pi. Published as `@gamaraan/ask-tool`. It **replaces** the obsolete
`@juicesharp/rpiv-ask-user-question` extension — never revive that name.

## Layout

```text
src/
  index.ts                 extension entry: default export registers flags + tool
  ask-tool.ts              ToolDefinition: schema wiring, 3-path dispatch, renderers
  schema.ts                TypeBox schema + structural validation + recoverAskQuestions
  types.ts                 AskToolDetails/QuestionResult/AskToolInput (explicit shapes)
  constants.ts             reserved labels, RECOMMENDED_SUFFIX, TIMEOUT_DETECTION_TOLERANCE_MS
  format.ts                pure helpers: recommended suffix, timeout auto-select, response text
  description.ts           LLM-facing tool description (port of omp prompts/tools/ask.md)
  config.ts                flag/env → timeout/notify resolution (D2)
  rpc-fallback.ts          Path B: per-question select/editor/confirm loop (exported AskUiContext)
  timers.ts                structural AbortLike/TimerGlobals (compiles without @types/node)
  dialog/
    ask-dialog-component.ts  Path A: the rich TUI dialog (port of omp ask-dialog.ts)
    countdown.ts             deadline-based CountdownTimer with reset (port of omp's)
    chrome.ts                box-drawing helpers (port of omp overlay-box.ts)
docs/                      research + implementation plan (the spec)
```text

Tests live in **pi-mono** (not here) so they reuse its vitest alias graph:
`pi-mono/packages/coding-agent/test/ask-user-question/`. This is a deliberate,
spec-mandated arrangement (plan §4 D1): the only files this project adds to
pi-mono are those test files.

## Architecture invariants

1. **Three execution paths, zero core changes.** `execute` dispatches on the
   `ExtensionContext`:
   - `!ctx.hasUI` → error result `"Error: Ask tool requires interactive mode"`,
     never throws, never opens a dialog (Path C).
   - `ctx.mode === "tui"` → rich dialog presented as a widget panel above
     the prompt editor (`ctx.ui.setWidget` + focus grab/restore; the widget
     is cleared on completion) — Path A.
   - everything else with UI → `askQuestionsViaSimpleRpc` (Path B).
2. **No core pi changes — ever.** Do NOT modify files under
   `pi-mono/packages/*/src/`. In particular: no `ExtensionUIContext.select`
   upgrades, no `askDialog`/`editor` members, no settings accessor, no
   plan-mode signal. Those are follow-ups (see Roadmap) in separate PRs.
   The only pi-mono additions allowed are test files under
   `packages/coding-agent/test/`.
3. **`executionMode: "sequential"`** — the pi analogue of omp's
   `concurrency = "exclusive"`. The dialog is a single shared UI surface.
4. **Esc cancels ⇒ `ctx.abort()` + cancelled result text** (no throw; pi's
   `AgentToolResult` has no `isError` field — error results are error-prefixed
   text). **Timeout auto-selects and does NOT abort** — the model must receive
   a real answer.
5. **Reserved-label contract.** Option labels must never equal
   `Other (type your own)` / `Chat about this` / `Next →` — schema validation
   (`findReservedLabelCollision`) rejects them. `Chat about this` is TUI-only
   (the RPC path does not offer it) — this is documented in the README feature
   matrix and pinned by tests.
6. **Timeout semantics.** Config: flag `--ask-timeout` > env
   `PI_ASK_TIMEOUT_SECONDS` > default `0` (disabled). Countdown re-arms on any
   key. `TIMEOUT_DETECTION_TOLERANCE_MS = 1000` distinguishes a UI-enforced
   timeout from a user Esc in the RPC path.
7. **No omp-only features.** No TTS (`vocaliz*`/`speech.*`), no
   `TERMINAL.sendNotification`, no plan-mode carve-out, no collab bridging.
   New code must not introduce them (the §12 audit greps for them).
8. **Zero runtime dependencies.** Imports only `@earendil-works/pi-*`
   (peers, resolved by pi's extension loader) and the standard library.
   `Type` is imported from `@earendil-works/pi-ai` (it re-exports typebox's
   `Type`); validation is structural in `schema.ts` — do not add direct
   `typebox` imports (vite cannot resolve them from outside pi-mono; the
   loader's virtual modules only cover `@earendil-works/*` and typebox paths).
9. **Self-typing without @types/node.** `src/timers.ts` provides structural
   `AbortLike` / timer views so the package compiles with or without node
   types. Keep new code free of bare `process`/`setTimeout` references.

## Commands

```bash
# Tests (78 cases across 7 files; plan floor is 51)
cd ../pi-mono/packages/coding-agent && npx vitest run test/ask-user-question

# Full regression sweep in pi-mono (no new failures allowed)
cd ../pi-mono/packages/coding-agent && npx vitest run

# Typecheck the package + the pi-mono graph
cd ../pi-mono && ./node_modules/.bin/tsgo --noEmit
cd ../pi-mono && ./node_modules/.bin/tsgo --noEmit -p ../ask-tool/tsconfig.json

# Lint (monorepo biome covers the test files)
cd ../pi-mono && npx biome check packages/coding-agent/test/ask-user-question/

# Package inspection
npm pack --dry-run
```text

Note: the pi-mono pre-existing suite has 15 environmental failures (CLI tests
spawning `src/cli.ts` on a node build without TS type-stripping) — unrelated
to this package; the plan's §10.3 regression gate compares against that
baseline.

## Conventions

- Biome-style formatting (tabs, 120 cols), matching pi-mono.
- `erasableSyntaxOnly`-compatible TS: no enums, no constructor parameter
  properties — declare fields explicitly.
- Ports from omp keep the original function names and output format where the
  user-visible contract matters (response text is golden-tested in
  `format.test.ts`). Divergences from omp are deliberate and must be
  documented in the README (feature matrix) and pinned by a test.
- Test files: `test/ask-user-question/` in pi-mono; imports use the
  `../../../../../ask-tool/src/...` relative path (5 levels up).
- Mock style: `test-helpers.ts` provides `fakeTheme` (ANSI-free passthrough),
  `fakeTui`, `setupHarness` (mock API + ctx), and pi key sequences (`keys`).

## Skill/extension replacement policy

Any skill, AGENTS.md, or doc that instructs agents to use the old
`@juicesharp/rpiv-ask-user-question` extension must be updated to name
`@gamaraan/ask-tool` (tool name: `ask`). Zero live references to the old name
may remain (plan §12 audit #9 greps `~/.pi/` and the package root).

## Roadmap (follow-ups, separate PRs — do NOT fold into this package)

1. Core `ExtensionUIContext.select` upgrade to items with descriptions (would
   enrich the RPC path).
2. Settings accessor on `ExtensionAPI` so `ask.timeout`/`ask.notify` become
   real settings (then fold the D2 flags into them).
3. Terminal notifications via a pi primitive (port of `TERMINAL.sendNotification`).
4. Plan-mode signal exposed to extensions (revisit the D3 decision).
5. `/tree` re-answer wiring (`recoverAskQuestions` is exported and tested).
6. Collab-guest bridging if pi gains a collab mode.
