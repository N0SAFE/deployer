import { defineConfig } from "eslint/config";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import turboConfig from 'eslint-config-turbo/flat';
import progress from '@deployer/config-eslint-plugins-progress';
import importPlugin from 'eslint-plugin-import';
import type { ESLint, Linter } from 'eslint';

const tsconfigRootDir = process.cwd();

export interface BaseConfigOptions {
    disableTseslint?: boolean;
}

/**
 * One import order for the whole repo.
 *
 * Groups, in order: Node builtins, npm packages, workspace packages
 * (`@deployer/*` — its own group, so a review sees the dependency direction
 * instead of hunting them among npm packages), app-internal aliases (`@/`,
 * `@<service>/`), then relative imports.
 *
 * `import/order` cannot resolve tsconfig aliases, so every alias that is not
 * scoped like a package must be listed in `pathGroups`; without it, `@/foo`
 * is classified as an npm package (anything starting with `@`).
 *
 * Fixable: `bun run lint:fix` rewrites the order, `bun run lint` only reports.
 */
const importOrderRules: Linter.RulesRecord = {
    "import/order": [
        "warn",
        {
            groups: [
                "builtin",
                "external",
                "internal",
                "parent",
                "sibling",
                "index",
                "object",
                "type",
            ],
            pathGroups: [
                { pattern: "@deployer/**", group: "internal", position: "before" },
                { pattern: "@/**", group: "internal", position: "after" },
                { pattern: "@identity/**", group: "internal", position: "after" },
                { pattern: "@project/**", group: "internal", position: "after" },
                { pattern: "@runtime/**", group: "internal", position: "after" },
                { pattern: "@fleet/**", group: "internal", position: "after" },
                { pattern: "@health/**", group: "internal", position: "after" },
            ],
            pathGroupsExcludedImportTypes: ["builtin"],
            "newlines-between": "always",
            alphabetize: { order: "asc", caseInsensitive: true },
        },
    ],
};

export const ignoresConfig = defineConfig([
    {
        ignores: ["dist/**/*", "build/**/*", "node_modules/**/*"],
    },
]);

export const baseConfig = (options: BaseConfigOptions = {}) => {
    const { disableTseslint = false } = options;
    
    return defineConfig([
        progress.configs['recommended-ci'],
        ...ignoresConfig,
        ...turboConfig,
        eslint.configs.recommended,
        ...(disableTseslint ? [] : [
            tseslint.configs.strictTypeChecked,
            tseslint.configs.stylisticTypeChecked,
        ]),
        {
            languageOptions: {
                parserOptions: {
                    projectService: true,
                    tsconfigRootDir,
                },
            },
        },
        {
            plugins: { import: importPlugin as unknown as ESLint.Plugin },
            rules: {
                ...importOrderRules,
                "@typescript-eslint/no-extraneous-class": "off",
                "@typescript-eslint/unified-signatures": "off",
                "@typescript-eslint/no-unnecessary-type-parameters": "off",
                // A leading underscore is this codebase's marker for a binding that
                // must be declared but is intentionally not read. That is not a
                // hypothetical: `infer _TContext, infer TInput, infer _TOutput,
                // infer _TError` are positional in `Client<...>`, so the unused
                // slots cannot be omitted. Without this, the only way to express
                // that was a per-line `eslint-disable-next-line`.
                "@typescript-eslint/no-unused-vars": [
                    "error",
                    {
                        argsIgnorePattern: "^_",
                        varsIgnorePattern: "^_",
                        caughtErrorsIgnorePattern: "^_",
                        destructuredArrayIgnorePattern: "^_",
                        ignoreRestSiblings: true,
                    },
                ],
            }
        }
    ]);
};

export const testConfig = (options: BaseConfigOptions = {}) => {
    const { disableTseslint = false } = options;
    
    return defineConfig([
        progress.configs['recommended-ci'],
        ...ignoresConfig,
        eslint.configs.recommended,
        ...(disableTseslint ? [] : [
            tseslint.configs.recommendedTypeChecked,
        ]),
        {
            languageOptions: {
                parserOptions: {
                    projectService: true,
                    tsconfigRootDir,
                },
            },
        },
        {
            plugins: { import: importPlugin as unknown as ESLint.Plugin },
            rules: {
                ...importOrderRules,
                "@typescript-eslint/no-extraneous-class": "off",
                "@typescript-eslint/no-unused-vars": ["warn"],
                "@typescript-eslint/no-explicit-any": "off",
                "@typescript-eslint/no-non-null-assertion": "off",
                "@typescript-eslint/no-unsafe-assignment": "off",
                "@typescript-eslint/no-unsafe-member-access": "off",
                "@typescript-eslint/no-unsafe-call": "off",
                "@typescript-eslint/no-unsafe-argument": "off",
                "@typescript-eslint/no-unsafe-return": "off",
                "no-unused-vars": "off",
                "@typescript-eslint/unbound-method": "off",
                "@typescript-eslint/unified-signatures": "off",
                "@typescript-eslint/no-deprecated": "off",
            },
        },
    ]);
};

export const allConfig = (options: BaseConfigOptions = {}) => {
    return defineConfig([
        testConfig(options),
        baseConfig(options),
    ]);
};

export default {
    meta: {
        name: "@deployer/config-eslint",
        version: "0.0.0",
    },
    configs: {
        ignores: ignoresConfig,
        base: baseConfig,
        test: testConfig,
        all: allConfig,
    },
} as const;
