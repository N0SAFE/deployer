/**
 * Config for `bun run lint:architecture`: the module-graph gate over every `src` file, nothing else.
 *
 * Kept apart from the per-workspace lint so the fast path stays fast — the facts process costs one TypeScript 7.1 snapshot per
 * run (~11 s, ~3 GB peak for the whole monorepo). It lints every `src` file, not only module files, because a missing
 * dependency is also reported in the PROVIDER's file, where the service is used.
 *
 * The rules are imported from source: Bun runs TypeScript, so this needs no build.
 */
import tseslint from "typescript-eslint";

import architecture from "./src/architecture";

export default [
	{ ignores: ["**/dist/**", "**/node_modules/**", "**/*.spec.ts", "**/*.test.ts", "**/e2e/**"] },
	{
		files: ["apps/**/src/**/*.ts", "packages/**/src/**/*.ts"],
		// The TS parser handles decorators and `declare const x: unique symbol`; Bun runs it natively.
		languageOptions: { parser: tseslint.parser },
		plugins: { "deployer-effect": architecture },
		rules: {
			"deployer-effect/requireModuleContext": "error",
			"deployer-effect/requirementFlow": "error",
		},
	},
];
