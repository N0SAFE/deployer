import { build } from '@deployer/pkg-build/config'

/**
 * The builder's own build config — and its build entry point.
 *
 * `build()` declares AND runs: this file is what `bun --bun pkg-build` executes.
 * The package therefore bootstraps through the same path as every other package
 * rather than a special-cased `src/main.ts`.
 *
 * No `minify` or `sourcemap` keys: the mode rule already gives this tool
 * minified, map-free output for the production image it ships inside, and
 * readable, mapped output for a dev build.
 */
export default build({
    root: 'src',
    entries: ['main.ts', 'cli.ts', 'variant-child.ts', 'config.ts'],
    formats: ['esm', 'cjs'],
    target: 'node',
    splitting: false,
})
