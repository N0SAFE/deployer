import libraryConfig from '@deployer/config-eslint/library'
import { defineConfig } from "@deployer/config-eslint";

export default defineConfig([
    {extends:[libraryConfig.configs.base()],
        files: ["src/**/*.{ts,tsx}"],
    },
])
