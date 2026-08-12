#!/usr/bin/env bash
set -euo pipefail

PI_MONO_DIR="${PI_MONO_DIR:-../pi-mono}"
TEST_DIR="$PI_MONO_DIR/packages/coding-agent/test/ask-user-question"

if [[ ! -d "$PI_MONO_DIR/packages/coding-agent" ]]; then
	echo "pi-mono checkout not found at $PI_MONO_DIR" >&2
	exit 1
fi
if [[ -e "$TEST_DIR" ]]; then
	echo "refusing to overwrite existing pi-mono test directory: $TEST_DIR" >&2
	exit 1
fi

mkdir -p "$TEST_DIR"
cp -r ci/pi-mono-tests/. "$TEST_DIR/"
cleanup() {
	rm -rf "$TEST_DIR"
}
trap cleanup EXIT

case "${1:-test}" in
	test)
		(cd "$PI_MONO_DIR/packages/coding-agent" && ../../node_modules/.bin/vitest run test/ask-user-question)
		;;
	lint)
		(cd "$PI_MONO_DIR" && ./node_modules/.bin/biome check packages/coding-agent/test/ask-user-question)
		;;
	*)
		echo "usage: $0 [test|lint]" >&2
		exit 2
		;;
esac
