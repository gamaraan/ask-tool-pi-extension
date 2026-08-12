# Desktop-notify integration plan

## Goal

Allow `@gamaraan/ask-tool` 0.2.0 to request a desktop notification while an
interactive ask dialog is waiting for input, when `--ask-notify on` (or
`PI_ASK_NOTIFY=on`) is effective. The integration is optional: ask-tool must
continue to load and work unchanged when `@gamaraan/desktop-notify` is absent.

## Compatibility contract

- Use pi's EventBus only: `pi.events.emit("desktop-notify:request", payload)`.
- Do **not** add `@gamaraan/desktop-notify` to `dependencies`, `peerDependencies`,
  `devDependencies`, imports, dynamic imports, package discovery, or install
  instructions.
- Emit only for the TUI dialog path (`ctx.mode === "tui"`) and only when the
  existing effective `ask-notify` setting is on. The existing `ctx.ui.notify`
  behavior remains as-is for every interactive UI mode.
- Emit one plain object per ask invocation before the dialog is opened:
  `{ title: "Ask", body: "Waiting for input", type: "ask", urgency: "normal", sound: "question" }`.
  It is intentionally composed without importing desktop-notify types.
- EventBus emission is fire-and-forget and must not alter cancellation,
  timeout, result, focus-restoration, or headless/RPC behavior. With no
  listener, `emit` is a no-op and the ask flow must still complete.

## Implementation tasks

### 1. Add the optional EventBus request at the ask dispatch boundary

**Files:** `src/ask-tool.ts` and, only if a local event-name constant is needed,
`src/constants.ts`.

1. Keep the current headless guard first.
2. Resolve the existing configuration once, retain the current in-UI notice,
   and emit the compatibility payload only for an enabled TUI ask.
3. Leave rich-dialog and RPC execution helpers independent of desktop-notify;
   neither helper may import or probe the sibling package.

**Tests to add/update:**

- In `../pi-mono/packages/coding-agent/test/ask-user-question/ask-tool.test.ts`,
  extend the recording API/EventBus harness and assert that a TUI ask with
  `ask-notify=on` emits the exact event name and payload once while retaining
  the existing `ctx.ui.notify` assertion.
- Pin the negative paths: notification off, RPC mode with notification on, and
  headless mode each emit no desktop-notify request. Preserve their existing
  result/abort assertions.

**Definition of done:**

- The only cross-extension call is `pi.events.emit` using the documented
  channel and exact plain-object contract.
- The normal ask result, timeout, cancellation, and widget cleanup semantics
  remain unchanged, and no desktop-notify import or package dependency exists.
- The new positive and negative tests pass.

### 2. Document the optional integration and prepare the 0.2.0 release

**Files:** `README.md`, `package.json`, and any lock/package metadata that
actually records this package's own version.

1. Add a concise Runtime behaviors or Configuration note explaining that
   `ask-notify` keeps the in-UI notification and additionally requests a
   best-effort desktop notification only when desktop-notify is loaded.
2. State explicitly that desktop-notify is optional and no action is required
   when it is unavailable.
3. Change the package version from `0.1.0` to `0.2.0`; do not change unrelated
   dependency versions.

**Tests to add/update:**

- Extend the discovery/package metadata assertion, or add a focused manifest
  test, to pin version `0.2.0` and retain the `ask-notify` flag registration.
- Add a text-level README assertion only if the repository's existing test
  conventions already validate documentation; otherwise review the rendered
  README as part of package inspection.

**Definition of done:**

- Package metadata is exactly `0.2.0`.
- Documentation accurately describes the optional EventBus behavior and does
  not imply a required sibling installation.
- No package dependency is added for desktop-notify.

## Final verification

Run after all implementation tasks are complete:

```bash
cd ../pi-mono/packages/coding-agent && npx vitest run test/ask-user-question
cd ../pi-mono && ./node_modules/.bin/tsgo --noEmit -p ../ask-tool/tsconfig.json
cd ../ask-tool && npm pack --dry-run --json
```

Also load a packaged `@gamaraan/ask-tool@0.2.0` in a TUI session twice: once
without desktop-notify (the ask dialog and `ctx.ui.notify` behavior must work)
and once with desktop-notify loaded (one best-effort waiting notification must
be requested per enabled TUI ask). Exercise disabled `ask-notify`, RPC, timeout,
and Escape cancellation in the same smoke pass.

## Overall definition of done

- ask-tool is released as version `0.2.0` with the EventBus-only integration.
- desktop-notify remains wholly optional; ask-tool is loadable, type-safe, and
  behaviorally identical except for the enabled TUI EventBus request.
- All focused tests, typecheck, package inspection, and the two-extension and
  no-listener manual smoke checks above pass.
