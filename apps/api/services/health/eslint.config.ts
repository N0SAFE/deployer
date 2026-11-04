import libraryConfig from '@deployer/config-eslint/library'
import nestjsConfig from '@deployer/config-eslint/nestjs'
import { defineConfig } from "@deployer/config-eslint"

export default defineConfig([
    {
        extends: [libraryConfig.configs.base()],
        files: ["src/**/*.{ts,tsx}"],
        rules: {
            "@typescript-eslint/no-extraneous-class": "off",
        },
    },
    // This service may only import the schema tables it owns. Ownership is the
    // directory: `@deployer/nest-schema/global/health/` (plus the shared `platform`
    // and `utils` directories). The union barrel is banned.
    {
        extends: [nestjsConfig.configs.serviceSchemaBoundary({ owner: "health" })],
    },
    // The Effect conventions (C1/C3/C5/C9/C10 of the migration inventory) — the whole gate for this app, since
    // its last `@Injectable` domain service is gone. `controllersUseProcedure` is part of it.
    {
        extends: [nestjsConfig.configs.effectConventions()],
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
