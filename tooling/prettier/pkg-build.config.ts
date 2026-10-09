import { defineConfig } from '@repo/pkg-build/config'

/** Build configuration for `@repo/config-prettier`. */
export default defineConfig({
    root: 'src',
    formats: ['esm', 'cjs'],
})
