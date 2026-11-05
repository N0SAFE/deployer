import { createNodeConfig, workspaceSourceAliases } from '@deployer/config-vitest';
import * as path from 'path';

const sharedSrc = path.resolve(import.meta.dirname, './src');

/**
 * The shared package's own tests.
 *
 * The `@` alias is REQUIRED, not a convenience: `shared/src` is the root of the
 * `@/core/*`, `@/config/*` and `@/auth` namespace, so its own files import each
 * other with those specifiers. Without the alias vitest cannot resolve them and
 * every test that touches shared code fails at import time.
 *
 * Deliberately NOT the app-level remap (which points `@/core/*` at
 * `../shared/src/core/*`): inside `shared`, `@` IS `./src`, so verifying the
 * package in isolation exercises the same specifiers the apps use, resolved one
 * level differently.
 *
 * ── WHY `@deployer/*` IS ALIASED TO SOURCE, AND `bun:sqlite` IS SHIMMED ─────
 * This config previously declared only `@`. A bare `@deployer/node-state` then
 * resolved to its `dist/`, which imports `bun:sqlite` — unresolvable outside
 * Bun — so specs died at import with `Cannot find package 'bun:sqlite'` whenever
 * they ran under Node (the VS Code test runner, the root project list) and
 * passed only under Bun. `workspaceSourceAliases` maps every workspace package
 * to its `src`; the shim is the same one the app configs use.
 */
export default createNodeConfig({
  resolve: {
    alias: [
      ...Object.entries(workspaceSourceAliases()).map(([find, replacement]) => ({
        find,
        replacement,
      })),
      { find: /^@\//, replacement: `${sharedSrc}/` },
      { find: /^@$/, replacement: sharedSrc },
      ...(process.versions.bun
        ? []
        : [
            {
              find: 'bun:sqlite',
              replacement: path.join(sharedSrc, 'e2e-harness/vitest/bun-sqlite-shim.ts'),
            },
          ]),
    ],
  },
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Same reason as the app configs: a dependency's `bun:sqlite` /
    // `zod/v4` subpath import is externalised unless the graph is inlined.
    server: { deps: { inline: true } },
  },
});
