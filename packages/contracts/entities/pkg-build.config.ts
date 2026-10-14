import { defineConfig } from '@deployer/pkg-build/config'

/** Build configuration for `@deployer/contracts-entities` — defaults apply. */
export default defineConfig({
    // Node programs load this package's CJS, so the output must be real CJS.
    // The default `bun` target emits an IIFE wrapper that Node evaluates without
    // exporting anything, so every symbol arrives `undefined` instead of failing.
    target: 'node',
    // Code splitting must stay off here. This package's barrels are reachable from
    // more than one entry (`index.ts` re-exports the nested `entities/*/index.ts`,
    // which are also entries), and bun then hoists those modules into chunks and
    // emits them without their re-exports: 395 of 678 symbols survive, silently.
    // Every consumer of this package fails with "Export named X not found".
    splitting: false,
});
