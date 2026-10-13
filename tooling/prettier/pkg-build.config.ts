import { defineConfig } from '@deployer/pkg-build/config'

/** Build configuration for `@deployer/config-prettier`. */
export default defineConfig({
    root: 'src',
    formats: ['esm', 'cjs'],
})
