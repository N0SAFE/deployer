import libraryConfig from '@deployer/config-eslint/library'
import { defineConfig } from "@deployer/config-eslint"
import nestjsConfig from '@deployer/config-eslint/nestjs'

export default defineConfig([
    // This package IS the bridge between Nest and Effect: `EffectRuntime` is the one @Injectable that owns the runtime, and
    // `ServiceLifecycleRunner` the one class that implements Nest's hooks FOR every service. They stay, by design;
    // everything else is banned. The ledger lists exactly them.
    {
        extends: [nestjsConfig.configs.nestRoles({ ledger: "./nest-roles.ledger.json" })],
    },
    {extends:[libraryConfig.configs.base()],
        files: ["src/**/*.{ts,tsx}"],
        rules: {
            "@typescript-eslint/no-extraneous-class": "off",
        },
    },
    {
        // Type-level machinery: `any` is load-bearing in variance checks and recursive router maps, and the
        // inference variables exist only to test a shape (`ProcedureContract<infer _A, ...>`).
        files: ["src/requirements.ts", "src/create-module-context.ts"],
        rules: {
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
            ],
        },
    },
    {extends: [libraryConfig.configs.test()],
        files: ["**/__tests__/**/*.{ts,tsx}", "**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
        rules: {
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unsafe-assignment": "off",
            "@typescript-eslint/no-unsafe-member-access": "off",
            "@typescript-eslint/no-unsafe-call": "off",
            "@typescript-eslint/no-unsafe-argument": "off",
            "@typescript-eslint/no-unsafe-return": "off",
        },
    },
])
