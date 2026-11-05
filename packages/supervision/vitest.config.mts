import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
    resolve: {
        // Cross-package imports resolve to source so tests never depend on a prior `build:types`.
        alias: {
            '@deployer/effect-core': fileURLToPath(
                new URL('../effect/core/src/index.ts', import.meta.url)
            ),
        },
    },
    test: {
        name: 'supervision',
        globals: true,
        environment: 'node',
        include: ['src/**/*.{test,spec}.ts'],
    },
})
