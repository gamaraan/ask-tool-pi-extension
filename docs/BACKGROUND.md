# Background: omp ↔ pi platform context

Foundational research the ask-tool port builds on. Self-contained — no references to other research folders.

---

## 1. The two repos

- **omp** = `oh-my-pi/` monorepo — a fork of pi with batteries added. Packages named `@oh-my-pi/pi-*` (e.g. `@oh-my-pi/pi-agent-core` 17.2.15, `@oh-my-pi/pi-ai`, `@oh-my-pi/pi-tui`, `@oh-my-pi/pi-utils`).
- **pi** = `pi-mono/` monorepo — upstream. Packages named `@earendil-works/pi-*` (e.g. `@earendil-works/pi-agent-core` 0.84.1, `@earendil-works/pi-coding-agent`).

Fork evidence:
- omp `packages/agent/package.json` credits Mario Zechner (pi's author) as contributor; repo `can1357/oh-my-pi` vs pi's `earendil-works/pi`.
- omp ships `extensibility/legacy-pi-ai-shim.ts` and `legacy-pi-coding-agent-shim.ts` for pi API compatibility.
- omp's `AgentSession` and `AgentTool` are the fork-ancestors of pi's — the core contracts stayed identical, which is what makes ports mechanical.

## 2. pi package layout relevant to tool work

- `packages/agent/` — `@earendil-works/pi-agent-core`: `AgentTool` interface, `Agent`/`agent-loop`, harness (WIP). Exports `AgentTool` at `src/types.ts:386`.
- `packages/agent/src/harness/` — the *new* durable runtime (lanes, entries/registers/usage ledger). **Spec + partial implementation**: session storage (memory/jsonl) implements lanes + custom entries with conformance tests, but `AgentHarness.create()` throws `HarnessNotImplemented("create.restore")` and `createLane()` returns `unavailable(...)` (`agent-harness.ts:347,447-451`). Not the integration surface for this port.
- `packages/coding-agent/` — `@earendil-works/pi-coding-agent`:
  - `core/agent-session.ts` (110 KB) — the shipped runtime (`AgentSession`), created via `core/sdk.ts:169` `createAgentSession`. Interactive mode runs on this.
  - `core/extensions/types.ts` — `ExtensionContext` (:307), `ToolDefinition` (:449), `ExtensionUIContext` (:131), `ExtensionUIDialogOptions` (:95).
  - `core/settings-manager.ts` — scoped (global/project) settings with `SettingsManager` class.
  - `modes/interactive/` — TUI mode: `interactive-mode.ts`, `components/`, `theme/`.
  - `modes/rpc/` — JSON-RPC mode with dialog bridging (`rpc-mode.ts:136-140`).
  - `examples/extensions/` — extension examples (todo, subagent, plan-mode).

## 3. API contract parity (verified)

| Contract | pi | omp (fork) |
|---|---|---|
| `AgentTool` | `@earendil-works/pi-agent-core` (src/types.ts:386) | `@oh-my-pi/pi-agent-core` — same shape |
| `execute` | `(toolCallId, params, signal, onUpdate, ctx) → Promise<AgentToolResult<T>>` | identical |
| `AgentToolResult<T>` | `{ content, details?, isError? }` (src/types.ts:361) | identical |
| extension tool def | `ToolDefinition` (core/extensions/types.ts:449): `name`, `label`, `description`, `parameters` (typebox), `execute` (:480-486), `renderCall`/`renderResult` (:489-497), `prepareArguments` (:468), `executionMode` (:477) | — (omp has its own custom-tools layer) |
| schema | typebox (`Type.Object`, `StringEnum`) | omptype (omp's DSL) — mechanical swap |
| session persistence | `SessionManager.getBranch()` + `appendCustomEntry`, toolResult `details` in branch entries | identical primitives |
| arg repair | `prepareArguments` shim | `lenientArgValidation` + in-execute repair |
| exclusive execution | `executionMode: "sequential"` | `concurrency = "exclusive"` |
| UI rendering | `renderCall`/`renderResult` → pi-tui `Component` | omp `todoToolRenderer`/`askToolRenderer` |

## 4. pi `AgentSession` event surface (extension hooks)

`AgentSessionEvent` (`core/agent-session.ts:141-147`): `agent_end` (with `willRetry`), `message_start/update/end`, `turn_start/end`, `tool_execution_start/update/end`, `compaction_start/end`, `session_start/tree/info_changed`, `agent_settled`, `auto_retry_*`, `queue_update`.

Extensions reach these via `pi.on(...)` → `_extensionRunner.emit(...)` (`agent-session.ts:730-807`). `subscribe(listener)` at `agent-session.ts:815`.

## 5. Runtime notes

- **Two runtimes coexist**: the shipped legacy `AgentSession` (interactive, rpc, json, print modes) and the unimplemented `AgentHarness`. Ports target the legacy runtime.
- pi's `ExtensionUIContext` is implemented per mode: interactive (`interactive-mode.ts:2348-2352`), RPC (`rpc-mode.ts:136-140`), print/no-op (`extensions/runner.ts:235`).
- pi's TUI (pi-tui) already ships `SelectList` (`packages/tui/src/components/select-list.ts`) supporting `{ label, description? }` items + selection markers — the building block for selector upgrades.
