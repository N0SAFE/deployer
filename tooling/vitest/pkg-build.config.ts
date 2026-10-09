import { defineConfig } from '@repo/pkg-build/config'

/** Build configuration for `@repo/config-vitest`. */
export default defineConfig({
    root: 'src',
    formats: ['esm', 'cjs'],
})
