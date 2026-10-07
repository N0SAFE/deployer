import { defineConfig } from 'vitest/config';
import { workspaceSourceAliases } from '@repo/config-vitest';
import path from 'path';

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
        '**/*.d.ts',
        '**/*.config.*',
        '**/index.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      // Resolve workspace packages to source, so a test never mixes the built
      // copy with the source it is exercising.
      ...workspaceSourceAliases(),
    },
    // A single zod instance, so schema identity checks (strict objects,
    // instanceof) behave consistently across source and dependencies.
    dedupe: ['zod'],
  },
});
