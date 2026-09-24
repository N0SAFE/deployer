import { defineConfig } from "eslint/config";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import turboConfig from 'eslint-config-turbo/flat';
import progress from '@repo/config-eslint-plugins-progress';

const tsconfigRootDir = process.cwd();

export interface BaseConfigOptions {
    disableTseslint?: boolean;
}

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
            rules: {
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
            rules: {
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
        name: "@repo/config-eslint",
        version: "0.0.0",
    },
    configs: {
        ignores: ignoresConfig,
        base: baseConfig,
        test: testConfig,
        all: allConfig,
    },
} as const;
