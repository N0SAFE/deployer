import { build } from '@deployer/pkg-build/config'

/** Build configuration for `@deployer/contracts-common` — defaults apply. */
export default build({
    // Node programs load this package's CJS, so the output must be real CJS.
    // The default `bun` target emits an IIFE wrapper that Node evaluates without
    // exporting anything, so every symbol arrives `undefined` instead of failing.
    target: 'node',
});
