import { defineConfig } from '@deployer/pkg-build/config'

/** Build configuration for `@deployer/cli-declarative-routing`. */
export default defineConfig({
    root: 'src',
    entries: ['index.ts'],
    formats: ['cjs'],
    flat: true,
    target: 'node',
    splitting: false,
    sourcemap: 'external',
    external: ['@parcel/watcher'],
})
