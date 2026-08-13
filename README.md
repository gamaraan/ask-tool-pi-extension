# @gamaraan/ask-tool

A [pi](https://github.com/earendil-works/pi) extension that ports the **ask tool**
from [Oh My Pi](https://github.com/can1357/oh-my-pi) (OMP): interactive
multiple-choice questions the agent asks the user mid-turn, with a rich TUI
dialog, recommended options, live timeouts with auto-select, free-text
answers, and multi-question paging.

It is the full replacement for the obsolete interactive-question extension.

## What it does

Gives the model a tool named **`ask`** that takes one or more questions:

```json
{
  "questions": [
    {
      "id": "storage",
      "question": "Which storage backend should the API use?",
      "header": "Storage",
      "options": [
        { "label": "SQLite", "description": "File-based, zero config." },
        { "label": "PostgreSQL", "description": "Server-based, feature-rich." },
        { "label": "MongoDB" }
      ],
      "recommended": 0
    },
    {
      "id": "auth",
      "question": "Which auth method?",
      "multi": true,
      "options": [
        { "label": "JWT", "description": "Bearer tokens." },
        { "label": "OAuth2" }
      ]
    }
  ]
}
```

- **`recommended: <index>`** marks the default option; `" (Recommended)"` is
  appended automatically and the cursor starts there.
- **`multi: true`** turns the question into a multi-select (checkboxes).
- **`header`** shows as a short chip in the dialog tab bar.
- **`description`** is displayed under each option; **`preview`** renders rich
  (markdown + code fences) content in the TUI dialog.
- **Reserved runtime options** are always offered and can never collide with
  model-provided labels (schema validation rejects them):
  - `Other (type your own)` — free-text answer (inline editor in TUI,
    `ctx.ui.editor` in RPC)
  - `Chat about this` — TUI-only redirect: the agent switches to conversation
    instead of answering
  - `Next →` — internal paging affordance
- **Timeout with auto-select**: when a configured timeout elapses without
  input, the recommended option (or the first) is auto-selected and the result
  is marked `timedOut` — the model receives a real answer, not a hang.
- **Multi-question dialogs** page with `Next →`/back navigation; multi-select
  questions confirm on a "Review answers" submit tab.

## Runtime behaviors

| Feature | TUI | RPC | print/headless |
| --- | --- | --- | --- |
| Rich multi-question dialog (tabs, previews, notes, submit tab) | ✅ | — | — |
| `Chat about this` redirect | ✅ | — | — |
| Option descriptions & markers | ✅ | — | — |
| Per-question `select` loop with `Other` free text | ✅ | ✅ | — |
| Multi-question back/forward via confirm gate | ✅ | ✅ | — |
| Timeout countdown + auto-select | ✅ | ✅ | — |
| Esc cancels the ask and aborts the turn | ✅ | ✅ | — |
| Error result instead of a dialog | — | — | ✅ |

`ctx.mode === "tui"` shows the rich dialog as a **widget panel in the extension
widget slot** — directly under the transcript, above the prompt editor — via
`ctx.ui.setWidget` (the dialog grabs keyboard focus while open and restores it
to the prompt afterwards, and is cleared when the answers are submitted).
Every other mode with UI (RPC) uses the simple per-question loop; headless
modes return an `Error: Ask tool requires interactive mode` result without
throwing.

When `ask-notify` is on, the existing in-UI waiting notice is retained. For TUI
asks in terminals advertising OSC 9/99 notifications (Kitty, Ghostty, WezTerm,
iTerm2, or Warp), ask-tool also emits a best-effort
`desktop-notify:request` EventBus event whose title is the first ask question
(and whose body remains `Waiting for input`). The terminal owns focus handling,
so a waiting notification is intended to appear only while its window is
inactive.
Unknown/base terminals do not receive the EventBus request because native
`notify-send` fallbacks cannot reliably determine terminal focus.

`@gamaraan/desktop-notify` is optional: when it is loaded it may handle the
request, and when it is unavailable no action is required.

## Configuration

Ask-tool stores persistent defaults in the global `ask-tool.json` file under
Pi's agent directory (normally `~/.pi/agent/ask-tool.json`). Configure it
interactively with `/ask-configure`; the file is written and extensions are
reloaded immediately when the wizard finishes.

The effective precedence is flag > environment > static JSON > built-in
default:

| Setting | Static JSON | Flag | Env | Default |
| --- | --- | --- | --- | --- |
| Timeout in seconds (0 = disabled) | `timeoutSeconds` | `--ask-timeout <seconds>` | `PI_ASK_TIMEOUT_SECONDS` | `0` (disabled) |
| Best-effort waiting notification | `notify` | `--ask-notify <off\|on>` | `PI_ASK_NOTIFY` | `false` |

Example static configuration:

```json
{
  "notify": true,
  "timeoutSeconds": 30
}
```

Example: `pi --ask-timeout 30` overrides the saved timeout for that session;
the countdown resets on key presses.

## Install & enable

The extension is a plain pi extension package. Enable it either by:

1. **npm package + `pi.extensions` discovery** — install `@gamaraan/ask-tool`
   wherever your pi packages live (e.g. add it to your pi config `packages`),
   or
2. **direct copy** — copy this repository (or the published package) into
   `~/.pi/agent/extensions/` so pi's extension discovery picks up
   `src/index.ts` (the `"pi": { "extensions": ["./src/index.ts"] }` manifest
   also works).

After a `/reload` (or restart), the model is offered the `ask` tool. Ask the
model to "list your tools" to confirm.

## Development

The source lives in `src/`; `AGENTS.md` documents the architecture,
invariants, and development commands.

Tests run through the pi-mono test runner (they reuse its vitest alias graph
for `@earendil-works/pi-*`):

```bash
cd ../pi-mono/packages/coding-agent
npx vitest run test/ask-user-question
```

Typecheck the package against the pi-mono sources:

```bash
cd ../pi-mono && ./node_modules/.bin/tsgo --noEmit -p ../ask-tool/tsconfig.json
```

See `AGENTS.md` for the architecture invariants and the roadmap.

## License

MIT — this package is a port of OMP's ask tool (itself a fork of pi); see
`LICENSE` for the original copyright notices (Mario Zechner, Can Bölük) and
the port notice.
