import { build } from '@deployer/pkg-build/config'

/**
 * Build configuration for `@deployer/runthenkill`.
 *
 * A single-entry Node CLI: one flat CJS file the `bin` points at, so the
 * published artifact is exactly `dist/index.js` with no chunk directory to
 * resolve from.
 *
 * `sourcemap` is deliberately NOT set: the mode rule gives dev builds maps and
 * prod builds none. An explicit value here would defeat it and ship maps in the
 * production image.
 */
export default build({
    root: 'src',
    entries: ['index.ts'],
    formats: ['cjs'],
    flat: true,
    target: 'node',
    splitting: false,
})
