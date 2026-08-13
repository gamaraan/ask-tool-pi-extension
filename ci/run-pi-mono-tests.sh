#!/usr/bin/env bash
set -euo pipefail

PI_MONO_DIR="${PI_MONO_DIR:-../pi-mono}"
ASK_TOOL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VITEST="$PI_MONO_DIR/node_modules/.bin/vitest"
BIOME="$PI_MONO_DIR/node_modules/.bin/biome"

if [[ ! -d "$PI_MONO_DIR/packages/coding-agent" ]]; then
	echo "pi-mono checkout not found at $PI_MONO_DIR" >&2
	exit 1
fi

case "${1:-test}" in
	test)
		(cd "$ASK_TOOL_DIR" && "$VITEST" --config ci/vitest.config.ts run ci/pi-mono-tests)
		;;
	lint)
		(cd "$ASK_TOOL_DIR" && "$BIOME" check ci/pi-mono-tests)
		;;
	*)
		echo "usage: $0 [test|lint]" >&2
		exit 2
		;;
esac
