/**
 * ESLint for the requirements demo: the module-graph gate and nothing else, so the demo's deliberate violations in
 * `gate-demo/` are the only findings. Run it with `bun run lint:requirements` (from `samples/api-sample`); editors pick
 * this file up because it is the nearest flat config.
 */
import tseslint from "typescript-eslint";

import architecture from "../../../tooling/eslint/dist/architecture.mjs";

const GATE = { root: import.meta.dirname, globs: ["src/**/*.module.ts", "gate-demo/**/*.module.ts"] };

export default [
	{ ignores: ["node_modules/**", "src/effect/**", "**/*.test.ts", "**/*.test-d.ts", "caveats.html"] },
	{
		files: ["**/*.ts"],
		languageOptions: { parser: tseslint.parser },
		plugins: { "deployer-effect": architecture },
		rules: {
			"deployer-effect/requireModuleContext": ["error", GATE],
			"deployer-effect/requirementFlow": ["error", GATE],
		},
	},
];
