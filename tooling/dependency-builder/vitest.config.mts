import { defineConfig } from 'vitest/config'
import { workspaceSourceAliases } from '@repo/config-vitest'

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: [
                'node_modules/**',
                'dist/**',
                '**/*.config.*',
                '**/*.d.ts',
                '**/index.ts',
            ],
        },
        // The tool is exercised against the real repository rather than in unit
        // tests, so an absent suite must not fail the run.
        passWithNoTests: true,
    },
    // Resolve internal packages to their sources, so a test exercising this
    // tool sees the source and not a stale built copy.
    resolve: {
        alias: {
            ...workspaceSourceAliases(),
        },
    },
})
