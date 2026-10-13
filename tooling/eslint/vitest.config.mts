import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        // The boundary rule reads the schema package's files from disk, so it needs the
        // real workspace layout rather than a mocked one.
        include: ['src/**/*.test.ts'],
    },
})
