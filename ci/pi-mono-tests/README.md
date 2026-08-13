# Vendored pi-mono unit tests (CI-only mirror)

This directory contains the ask-tool unit tests. They run from this repository
using pi-mono's installed Vitest package and source tree as a read-only test
host; pi-mono must never receive committed feature or test changes.

Imports use `../../src/...` for ask-tool and `../../../pi-mono/...` only for
pi-mono test-host modules. Run them with `npm test` or `npm run lint:test`.
