/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'

/**
 * `@repo/pkg-build` is a build tool: its tests cover the config resolver and
 * the command adapter. Declaring its own config keeps it from inheriting the
 * root workspace config, whose `projects` glob expects every package to
 * contribute test files.
 */
export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/**/*.{test,spec}.ts'],
    },
})
