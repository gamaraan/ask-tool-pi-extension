/**
 * End-to-end extension discovery test (plan T8 / §9.2: 2 cases).
 *
 * Drops a shim into a temp extensions dir that re-exports the real
 * @gamaraan/ask-tool entry, runs pi's `discoverAndLoadExtensions`, and
 * asserts the `ask` tool and its flags are registered with no load errors.
 */
// pi-lens-ignore: typescript:2307
import * as fs from "node:fs";
// pi-lens-ignore: typescript:2307
import * as os from "node:os";
// pi-lens-ignore: typescript:2307
import * as path from "node:path";
// pi-lens-ignore: typescript:2307
import { fileURLToPath } from "node:url";
// pi-lens-ignore: typescript:2307
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// pi-lens-ignore: typescript:2307
import { discoverAndLoadExtensions } from "../../../pi-mono/packages/coding-agent/src/core/extensions/loader.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// test/ask-user-question → pi-mono root → ask-tool/src/index.ts
const packageEntry = path.resolve(__dirname, "../../src/index.ts");
const packageManifest = path.resolve(__dirname, "../../package.json");

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
		fs.writeFileSync(
			path.join(shimDir, "index.ts"),
			`export { default } from ${JSON.stringify(packageEntry)};\n`,
		);

		const result = await discoverAndLoadExtensions([], tempDir, tempDir);

		expect(result.errors).toEqual([]);
		expect(result.extensions).toHaveLength(1);
		const extension = result.extensions[0];
		expect(extension.tools.has("ask")).toBe(true);
		expect(extension.flags.has("ask-timeout")).toBe(true);
		expect(extension.flags.has("ask-notify")).toBe(true);
	});

	it("pins the 0.2.0 manifest without a desktop-notify dependency", () => {
		const manifest = JSON.parse(fs.readFileSync(packageManifest, "utf8")) as {
			version?: string;
			dependencies?: Record<string, unknown>;
			devDependencies?: Record<string, unknown>;
			peerDependencies?: Record<string, unknown>;
		};
		expect(manifest.version).toBe("0.2.0");
		for (const dependencies of [
			manifest.dependencies,
			manifest.devDependencies,
			manifest.peerDependencies,
		]) {
			expect(dependencies ?? {}).not.toHaveProperty("@gamaraan/desktop-notify");
		}
	});

	it("registers the sequential ask tool with the ported description", async () => {
		const shimDir = path.join(extensionsDir, "ask-user-question");
		fs.mkdirSync(shimDir);
		fs.writeFileSync(
			path.join(shimDir, "index.ts"),
			`export { default } from ${JSON.stringify(packageEntry)};\n`,
		);

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
