import { build } from '@deployer/pkg-build/config'

/**
 * `@deployer/errors` — pure TypeScript, no runtime dependencies, no JSX.
 *
 * Defaults cover it entirely; the file exists so the build surface is
 * discoverable from the package root (and so a future override has a home).
 */
export default build({
    // Node programs load this package's CJS, so the output must be real CJS.
    // The default `bun` target emits an IIFE wrapper that Node evaluates without
    // exporting anything, so every symbol arrives `undefined` instead of failing.
    target: 'node',
});
