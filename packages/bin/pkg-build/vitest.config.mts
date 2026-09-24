/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'

/**
 * `@repo/pkg-build` is a build tool, not a library: it has no unit tests.
 * Declaring its own config keeps it from inheriting the root workspace config,
 * whose `projects` glob expects every package to contribute test files.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.{test,spec}.{ts,mts}'],
    passWithNoTests: true,
  },
})
