import { defineConfig } from '@repo/pkg-build/config'

/** Build configuration for `@repo/api-contracts`. */
export default defineConfig({
    root: '.',
    entries: ['index.ts'],
    formats: ['esm'],
    flat: true,
    target: 'bun',
    minify: true,
    external: ['@orpc/contract', '@orpc/shared', 'zod'],
})
