/**
 * End-to-end extension discovery test (plan T8 / §9.2: 2 cases).
 *
 * Drops a shim into a temp extensions dir that re-exports the real
 * @gamaraan/ask-tool entry, runs pi's `discoverAndLoadExtensions`, and
 * asserts the `ask` tool and its flags are registered with no load errors.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverAndLoadExtensions } from "../../src/core/extensions/loader.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// test/ask-user-question → pi-mono root → ask-tool/src/index.ts
const packageEntry = path.resolve(__dirname, "../../../../../ask-tool/src/index.ts");

describe("ask-tool extension discovery", () => {
	let tempDir: string;
	let extensionsDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ask-ext-test-"));
		extensionsDir = path.join(tempDir, "extensions");
		fs.mkdirSync(extensionsDir);
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("loads the package entry with zero errors and registers the ask tool", async () => {
		const shimDir = path.join(extensionsDir, "ask-user-question");
		fs.mkdirSync(shimDir);
		fs.writeFileSync(path.join(shimDir, "index.ts"), `export { default } from ${JSON.stringify(packageEntry)};\n`);

		const result = await discoverAndLoadExtensions([], tempDir, tempDir);

		expect(result.errors).toEqual([]);
		expect(result.extensions).toHaveLength(1);
		const extension = result.extensions[0];
		expect(extension.tools.has("ask")).toBe(true);
		expect(extension.flags.has("ask-timeout")).toBe(true);
		expect(extension.flags.has("ask-notify")).toBe(true);
	});

	it("registers the sequential ask tool with the ported description", async () => {
		const shimDir = path.join(extensionsDir, "ask-user-question");
		fs.mkdirSync(shimDir);
		fs.writeFileSync(path.join(shimDir, "index.ts"), `export { default } from ${JSON.stringify(packageEntry)};\n`);

		const result = await discoverAndLoadExtensions([], tempDir, tempDir);
		expect(result.errors).toEqual([]);

		const registered = result.extensions[0]?.tools.get("ask");
		expect(registered).toBeDefined();
		const definition = registered?.definition as {
			name?: string;
			executionMode?: string;
			description?: string;
		};
		expect(definition.name).toBe("ask");
		expect(definition.executionMode).toBe("sequential");
		expect(definition.description).toContain("Other (type your own)");
		expect(definition.description).not.toMatch(/vocaliz|speech|notification/i);
	});
});
