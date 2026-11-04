import { defineConfig } from "@deployer/config-eslint";
import nestjsConfig from "@deployer/config-eslint/nestjs";

export default defineConfig([
    // Every Nest role the Effect + oRPC integration replaces is banned (docs/architecture/effect-orpc-conventions.md), file by file:
    // `nest-roles.ledger.json` lists the files that have not migrated yet. Delete an entry when its file migrates.
    {
        extends: [nestjsConfig.configs.nestRoles({ ledger: `${import.meta.dirname}/nest-roles.ledger.json` })],
    },
    {
        extends: [nestjsConfig.configs.base()],
        files: ["src/**/*"],
        ignores: [
            "**/*.spec.ts",
            "**/*.test.ts",
            "**/*.mock.ts",
            "**/__tests__/**/*",
            "**/*.test.*",
        ],
    },
    {
        extends: [nestjsConfig.configs.test()],
        files: [
            "src/**/*.spec.ts",
            "src/**/*.test.ts",
            "src/**/*.mock.ts",
            "src/**/__tests__/**/*",
            "src/**/*.test.*",
        ],
    },
    // Controllers go through `procedure()` so the authz gate is applied wherever authz is configured (`SEC-062`).
    {
        extends: [nestjsConfig.configs.controllersUseProcedure()],
    },
]);
