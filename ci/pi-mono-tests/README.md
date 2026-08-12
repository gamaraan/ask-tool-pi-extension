# Vendored pi-mono unit tests (CI-only mirror)

This directory contains the ask-tool unit tests that CI stages into a fresh
pi-mono checkout as a temporary test host. The canonical test sources remain
inside this repository; pi-mono must never receive committed feature or test
changes.

The tests run inside the temporary pi-mono checkout because they reuse its
vitest alias graph and `../pi-mono/node_modules` (typeRoots/tsconfig paths), and
they import the ask-tool sources via the relative path
`../../../../../ask-tool/src/…` after staging:

`ci/pi-mono-tests/` exists solely so CI can stage the tests into the temporary
pi-mono checkout before running them:

```bash
mkdir -p pi-mono/packages/coding-agent/test/ask-user-question
cp -r ci/pi-mono-tests/. pi-mono/packages/coding-agent/test/ask-user-question/
```

## Running locally

The repository's test script stages these files into a sibling pi-mono checkout
before invoking Vitest. CI does the same in a fresh checkout. Do not edit or
commit files under the pi-mono repository; edit this mirror instead.
