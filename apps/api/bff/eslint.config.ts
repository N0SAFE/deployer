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
    // Controllers must go through `procedure()` so the authz gate is always applied (`SEC-062`).
    {
        extends: [nestjsConfig.configs.controllersUseProcedure()],
    },
])
