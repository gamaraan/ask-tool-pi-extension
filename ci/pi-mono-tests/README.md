# Vendored pi-mono unit tests (CI-only mirror)

This directory is a **CI-only mirror** of the unit tests whose canonical home
is the pi-mono monorepo:

```text
pi-mono/packages/coding-agent/test/ask-user-question/
```

The tests must run inside the pi-mono checkout because they reuse its vitest
alias graph and `../pi-mono/node_modules` (typeRoots/tsconfig paths), and they
import the ask-tool sources via the relative path `../../../../../ask-tool/src/…`.

`ci/pi-mono-tests/` exists solely so CI can stage the tests into the pi-mono
checkout before running them (they are not committed to pi-mono main yet):

```bash
mkdir -p pi-mono/packages/coding-agent/test/ask-user-question
cp -r ci/pi-mono-tests/. pi-mono/packages/coding-agent/test/ask-user-question/
```

## Syncing

Keep this mirror byte-identical to the pi-mono test directory. After editing
tests in pi-mono, re-copy them here:

```bash
cp -r ../pi-mono/packages/coding-agent/test/ask-user-question/. ci/pi-mono-tests/
```

**Delete this directory once the tests are committed to pi-mono main** — the
CI `test`/`publish` workflows then stage from the pi-mono checkout instead of
this mirror.
