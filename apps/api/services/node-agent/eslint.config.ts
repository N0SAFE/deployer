import libraryConfig from '@deployer/config-eslint/library'
import { defineConfig } from "@deployer/config-eslint"
import nestjsConfig from '@deployer/config-eslint/nestjs'

export default defineConfig([
    // Every Nest role the Effect + oRPC integration replaces is banned (docs/architecture/effect-orpc-conventions.md), file by file:
    // `nest-roles.ledger.json` lists the files that have not migrated yet. Delete an entry when its file migrates.
    {
        extends: [nestjsConfig.configs.nestRoles({ ledger: `${import.meta.dirname}/nest-roles.ledger.json` })],
    },
    {
        extends: [libraryConfig.configs.base()],
        files: ["src/**/*.{ts,tsx}"],
        rules: {
            "@typescript-eslint/no-extraneous-class": "off",
        },
    },
    {
        extends: [libraryConfig.configs.test()],
        files: ["**/*.spec.{ts,tsx}", "**/*.test.{ts,tsx}"],
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
