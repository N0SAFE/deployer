import { defineConfig } from 'vitest/config'
import { workspaceSourceAliases } from '@deployer/config-vitest'

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
        '**/index.ts', // Re-export file
      ],
    },
  },
  // Resolve workspace packages to source. Without this, `@deployer/env/utils`
  // loads the built copy while the test exercises the source.
  resolve: {
    alias: {
      ...workspaceSourceAliases(),
    },
  },
})
