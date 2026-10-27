import nextjsConfig from '@deployer/config-eslint/nextjs'
import { defineConfig } from "@deployer/config-eslint";

export default defineConfig([
    {
        extends: [nextjsConfig.configs.base()],
        files: ["src/**/*.{ts,tsx,js,jsx}"],
        ignores: [
            // Ignore node_modules and external packages for type-checking
            "**/node_modules/**",
            "**/.next/**",
            // Vendored third-party map components (MapLibre wrappers): kept close to
            // upstream so they can be re-synced; their lint noise is not ours to fix.
            "src/components/ui/map.tsx",
            "src/components/ui/place-autocomplete.tsx",
            // Ignore auto-generated declarative-routing files
            "src/routes/index.ts",
            "src/routes/openapi.ts",
        ],
        rules: {
            // Disable this rule to prevent stack overflow on complex recursive types
            "@typescript-eslint/no-unnecessary-type-parameters": "off",
        },
    },
    {extends: [nextjsConfig.configs.test()],
        files: ["**/__tests__/**/*.{ts,tsx,js,jsx}", "**/*.test.{ts,tsx,js,jsx}", "**/*.spec.{ts,tsx,js,jsx}"],
    },
])