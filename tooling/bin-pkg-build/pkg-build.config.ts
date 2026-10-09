import { defineConfig } from '@repo/pkg-build/config'

/**
 * The builder's own build config.
 *
 * Self-built from source (`bun --bun src/main.ts`), because the CLI has to exist
 * before anything it builds. `config.ts` is a second entry so consumers can
 * import the schema, `defineConfig`, and the types from `@repo/pkg-build/config`.
 *
 * `sourcemap: 'none'` and minification (the production default) because this is
 * a tool shipped inside the workspace image, not a library consumers bundle.
 */
export default defineConfig({
    root: 'src',
    entries: ['main.ts', 'variant-child.ts', 'config.ts'],
    formats: ['esm', 'cjs'],
    target: 'node',
    splitting: false,
})
