import { fileURLToPath } from "node:url";
import {
	defineConfig,
	mergeConfig,
} from "../../pi-mono/node_modules/vitest/dist/config.js";
import baseConfig, { workspaceSourcePaths } from "../../pi-mono/vitest.base.ts";

export default mergeConfig(
	baseConfig,
	defineConfig({
		test: {
			globals: true,
			environment: "node",
			testTimeout: 30000,
			env: { PI_OFFLINE: "1" },
			unstubEnvs: true,
			reporters: ["dot"],
			silent: "passed-only",
			server: {
				deps: {
					external: [/@silvia-odwyer\/photon-node/],
				},
			},
		},
		resolve: {
			alias: [
				{
					find: /^@earendil-works\/pi-coding-agent$/,
					replacement: workspaceSourcePaths.codingAgentIndex,
				},
				{
					find: /^@earendil-works\/pi-coding-agent\/(.+)$/,
					replacement: `${fileURLToPath(new URL("../../pi-mono/packages/coding-agent/src/", import.meta.url))}$1`,
				},
			],
		},
	}),
);
