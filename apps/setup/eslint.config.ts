import { defineConfig } from "@deployer/config-eslint";
import nestjsConfig from "@deployer/config-eslint/nestjs";

export default defineConfig([
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
