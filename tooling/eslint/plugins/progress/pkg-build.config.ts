import { defineConfig } from '@deployer/pkg-build/config'

/**
 * Build configuration for `@deployer/config-eslint-plugins-progress`.
 *
 * A single-entry ESM plugin: ESLint loads it directly, so the output is flat
 * (`dist/index.js`) and the `exports` map points at exactly that. `nanospinner`
 * and `picocolors` stay external — they are the plugin's declared dependencies,
 * resolved from the consumer's install like any other package.
 */
export default defineConfig({
    root: 'src',
    entries: ['index.ts'],
    formats: ['esm'],
    flat: true,
    target: 'node',
    splitting: false,
})
