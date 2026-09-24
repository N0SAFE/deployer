import libraryConfig from '@repo/config-eslint/library'
import { defineConfig } from "@repo/config-eslint"

export default defineConfig([
    {extends:[libraryConfig.configs.base()],
        files: ["src/**/*.{ts,tsx}"],
        rules: {
            /**
             * `Record<never, never>` is this builder's model for "no params /
             * query / body / headers". It is deliberate, not an accidental `{}`:
             * it satisfies `Record<string, AnySchema>` while contributing no keys.
             *
             * Why an exemption rather than a code change — all four candidates
             * were measured against `tsc --noEmit`, and each broke the build:
             *   `object`                  -> 29 errors (no index signature)
             *   `Record<string, never>`   ->  2 errors (index sig makes `.omit` vanish)
             *   `Record<string, AnySchema>` -> 25 errors (widens 45 sites)
             *   `Record<PropertyKey, never>` -> 2 errors (same `.omit` loss)
             *
             * The rule exposes no option (`schema: []` in
             * @typescript-eslint/eslint-plugin@8.70.0), so a scope-limited
             * exemption is the only way to keep a correct type without a
             * per-line `eslint-disable`.
             */
            "@typescript-eslint/no-generated-empty-object-type": "off",
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
