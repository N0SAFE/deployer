import { defineConfig } from '@deployer/pkg-build/config'

import { bundleTs6Island } from './src/plugins/bundle-ts6-island'

/**
 * Build configuration for `@deployer/config-eslint`.
 *
 * ── THE ONE PACKAGE THAT NEEDS A PLUGIN ─────────────────────────────────────
 * Everything else here is declarative. This package is not, for one reason:
 * `typescript-eslint@8` peer-requires `typescript <6.1.0` while every app
 * compiles against TypeScript 7, so the build must bundle its OWN TS6 and
 * redirect every `typescript` import to it (see the plugin's own note). That
 * redirect is resolution logic, which a config cannot express — hence `plugins`.
 *
 * ── WHY NOT BOTH FORMATS ────────────────────────────────────────────────────
 * The consumers are ESLint config files loaded by tooling that reads ESM, and
 * the previous build emitted ESM only. Emitting CJS as well would double the
 * bundled TS6 island for a format nothing loads.
 *
 * ── WHY NO `sourcemap` KEY ──────────────────────────────────────────────────
 * The mode rule decides: dev builds link a map, prod builds ship none. Setting
 * it here would force one value on both, and the production image is exactly
 * where the bundle's map is dead weight.
 */
export default defineConfig({
    root: 'src',
    entries: [
        'index.ts',
        'library.ts',
        'nextjs.ts',
        'nestjs.ts',
        'react.ts',
        'mdx.ts',
    ],
    formats: ['esm'],
    flat: true,
    target: 'node',
    splitting: false,
    plugins: [bundleTs6Island],
})
