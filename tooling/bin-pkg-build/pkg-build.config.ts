import { defineConfig } from '@deployer/pkg-build/config'

/**
 * The builder's own build config.
 *
 * Self-built from source (`bun --bun src/main.ts`), because the CLI has to exist
 * before anything it builds. `config.ts` is a second entry so consumers can
 * import the schema, `defineConfig`, and the types from `@deployer/pkg-build/config`.
 *
 * No `minify` or `sourcemap` keys: the mode rule already gives this tool
 * minified, map-free output for the production image it ships inside, and
 * readable, mapped output for a dev build.
 */
export default defineConfig({
    root: 'src',
    entries: ['main.ts', 'variant-child.ts', 'config.ts'],
    formats: ['esm', 'cjs'],
    target: 'node',
    splitting: false,
})
