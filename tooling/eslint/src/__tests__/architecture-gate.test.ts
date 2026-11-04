import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

import architecture from "../architecture";

/**
 * The gate end to end — the real facts process (TypeScript 7.1) over the requirements demo, through the ESLint API.
 * `samples/api-sample` has its own `node_modules`; without them its types cannot resolve, so the suite is skipped rather than
 * reporting a wrong "clean".
 */
const demo = resolve(import.meta.dirname, "../../../../samples/api-sample/requirements-demo");
const installed = existsSync(resolve(demo, "../node_modules/@nestjs"));

const gate = { root: demo, globs: ["src/**/*.module.ts", "gate-demo/**/*.module.ts"] };

function linter(options: unknown) {
	return new ESLint({
		cwd: demo,
		overrideConfigFile: true,
		overrideConfig: [
			{ ignores: ["src/effect/**", "**/*.test.ts", "**/*.test-d.ts"] },
			{
				files: ["**/*.ts"],
				languageOptions: { parser: tseslint.parser },
				plugins: { "deployer-effect": architecture },
				rules: { "deployer-effect/requireModuleContext": ["error", options], "deployer-effect/requirementFlow": ["error", options] },
			},
		],
	});
}

const findings = async (eslint: ESLint, patterns: string[]) =>
	(await eslint.lintFiles(patterns)).flatMap((result) =>
		result.messages.map((message) => `${result.filePath.slice(demo.length + 1)}:${message.line}:${message.column} ${message.messageId}`),
	);

describe.skipIf(!installed)("architecture gate on the requirements demo", () => {
	it("reports every violation at the exact place, and nothing else", { timeout: 120_000 }, async () => {
		expect(await findings(linter(gate), ["."])).toEqual([
			"gate-demo/broken-exports.module.ts:13:3 duplicateProvider",
			"gate-demo/broken-exports.module.ts:15:23 unknownExport",
			"gate-demo/consumer-missing-import.module.ts:10:16 missingDependency", // MeshDirectory
			"gate-demo/consumer-missing-import.module.ts:10:16 missingDependency", // ReplicaStore
			"gate-demo/directory-without-store.module.ts:12:16 missingDependency", // ReplicaStore, via MeshDirectory
			"gate-demo/legacy.module.ts:13:14 bareModule",
			// Non-ASCII text before the call and on the line: positions are UTF-16 columns on both sides.
			"gate-demo/unicode-positions.module.ts:9:16 missingDependency",
			"gate-demo/unicode-positions.module.ts:9:16 missingDependency",
			// The other end of the same gaps, in the files whose code uses the missing service.
			"src/modules/consumer/controllers/directory-reader.controller.ts:21:29 missingDependencyHere", // from consumer-missing-import
			"src/modules/consumer/controllers/directory-reader.controller.ts:21:29 missingDependencyHere", // from unicode-positions
			"src/modules/mesh/services/directory.service.ts:43:25 missingDependencyHere",
			"src/modules/mesh/services/directory.service.ts:59:25 missingDependencyHere",
			"src/modules/mesh/services/directory.service.ts:64:25 missingDependencyHere",
			"src/modules/mesh/services/directory.service.ts:80:25 missingDependencyHere",
		]);
	});

	it("keeps the clean fixtures clean", { timeout: 120_000 }, async () => {
		expect(await findings(linter(gate), ["gate-demo/consumer-ok.module.ts", "gate-demo/declared.module.ts"])).toEqual([]);
	});

	it("never passes a module file it has no analysis for", { timeout: 120_000 }, async () => {
		// Scope that leaves `gate-demo/` out: its files are linted but were never analysed.
		const outOfScope = { root: demo, globs: ["src/**/*.module.ts"] };
		const result = await findings(linter(outOfScope), ["gate-demo/legacy.module.ts", "gate-demo/consumer-ok.module.ts"]);
		expect(result).toEqual([
			"gate-demo/legacy.module.ts:13:14 noFacts",
			"gate-demo/consumer-ok.module.ts:6:33 noFacts",
		]);
	});

	it("rejects a misspelt option instead of ignoring it", { timeout: 120_000 }, async () => {
		await expect(findings(linter({ root: demo, glob: ["typo"] }), ["gate-demo/legacy.module.ts"])).rejects.toThrow();
	});
});
