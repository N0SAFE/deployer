import { defineConfig } from 'vitest/config';
import * as path from 'path';

/**
 * The shared package's own tests.
 *
 * The `@` alias is REQUIRED, not a convenience: `shared/src` is the root of the
 * `@/core/*`, `@/config/*` and `@/auth` namespace, so its own files import each
 * other with those specifiers. Without the alias vitest cannot resolve them and
 * every test that touches shared code fails at import time.
 *
 * Deliberately NOT the app-level remap (which points `@/core/*` at
 * `../shared/src/core/*`): inside `shared`, `@` IS `./src`, so verifying the
 * package in isolation exercises the same specifiers the apps use, resolved one
 * level differently.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
});
