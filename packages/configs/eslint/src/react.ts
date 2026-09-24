import { defineConfig } from "eslint/config";
import { plugin as shadcn } from "@shadcn/lint";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import pluginQuery from "@tanstack/eslint-plugin-query";
import globals from "globals";
import tsEslint from "typescript-eslint";
import coreConfig, { type BaseConfigOptions } from "./base";

export type ReactConfig = BaseConfigOptions;

const coreBaseFactory = coreConfig.configs.base;
const coreTestFactory = coreConfig.configs.test;

const tsconfigRootDir = process.cwd();

// Plugin registration only. No `shadcn/*` rules are enabled here on purpose:
// choosing which design-system rules apply is a decision for each app's own
// eslint.config.ts (https://github.com/shadcn-ui/lint#rules).
const shadcnLintConfig = {
    files: ["**/*.{js,mjs,cjs,jsx,mjsx,ts,tsx,mtsx}"],
    plugins: {
        shadcn,
    },
    settings: {
        shadcn: {
            // The workspace UI package is imported as `@repo/ui/components/...`
            // (shadcn, atomics, data-table). `apps/web` and `packages/ui/base`
            // have their own `components.json` for local component discovery.
            componentImports: ["^@repo/ui/components/"],
        },
    },
};

const base = (options: ReactConfig = {}) => defineConfig([
    coreBaseFactory(options),
    shadcnLintConfig,
    {
        files: ["**/*.{js,mjs,cjs,jsx,mjsx,ts,tsx,mtsx}"],
        ...reactPlugin.configs.flat.recommended,
        languageOptions: {
            parser: tsEslint.parser,
            ...reactPlugin.configs.flat.all!.languageOptions,
            parserOptions: {
                ...reactPlugin.configs.flat.all!.languageOptions?.parserOptions,
                tsconfigRootDir,
            },
            globals: {
                ...globals.serviceworker,
                ...globals.browser,
            },
        },
        settings: {
            react: {
                version: "detect",
            },
        },
        rules: {
            "react/react-in-jsx-scope": "off", // Not needed with React 17+ JSX transform
        },
    },
    reactHooks.configs.flat['recommended-latest']!,
    ...pluginQuery.configs["flat/recommended"],
]);

const test = (options: ReactConfig = {}) => defineConfig([
    coreTestFactory(options),
    shadcnLintConfig,
    {
        files: ["**/*.{test,spec}.{js,mjs,cjs,jsx,mjsx,ts,tsx,mtsx}"],
        ...reactPlugin.configs.flat.recommended,
        languageOptions: {
            parser: tsEslint.parser,
            ...reactPlugin.configs.flat.all!.languageOptions,
            parserOptions: {
                ...reactPlugin.configs.flat.all!.languageOptions?.parserOptions,
                tsconfigRootDir,
            },
            globals: {
                ...globals.serviceworker,
                ...globals.browser,
            },
        },
        settings: {
            react: {
                version: "detect",
            },
        },
        rules: {
            "react/react-in-jsx-scope": "off", // Not needed with React 17+ JSX transform
            "@typescript-eslint/no-empty-function": "off",
        },
    },
    reactHooks.configs.flat['recommended-latest']!,
    ...pluginQuery.configs["flat/recommended"],
]);

const all = (options: ReactConfig = {}) => defineConfig([
    base(options),
    test(options),
]);

export default {
    meta: {
        name: "@repo/config-eslint/react-internal",
        version: "0.0.0",
    },
    configs: {
        base,
        test,
        all,
    },
} as const;
