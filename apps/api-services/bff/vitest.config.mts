import { defineConfig, ViteUserConfigExport } from "vitest/config";
import swc from "unplugin-swc";
import * as path from "path";
import { createNodeConfig } from "@deployer/config-vitest/node";

const IS_BUN_RUNTIME = Boolean(process.versions.bun);

/**
 * The BFF's test config.
 *
 * ── WHY THIS MIRRORS `apps/api` ─────────────────────────────────────────────
 * `createNodeConfig` aliases every `@deployer/*` workspace package to its `src`
 * directory. That is not cosmetic: packages publish `exports` whose runtime
 * targets are `dist/**`, so without the alias an import of
 * `@deployer/orpc-utils/builder/x` would load the BUILT copy while a sibling module
 * imports the SOURCE directly. Two module instances break shared state and
 * circular initialisation (`Cannot access 'X' before initialization`).
 *
 * `esbuild: false` + the SWC plugin because NestJS depends on LEGACY decorators
 * with `emitDecoratorMetadata`, which esbuild's transform does not emit — vitest
 * could not even PARSE a decorated class without this.
 */
const TEST_RESOLVE = {
  // ── THE ARRAY FORM, AND THE ORDER IS THE POINT ────────────────────────────
  // An OBJECT alias is matched by prefix with no guaranteed specificity order, so
  // `"@"` can win over `"@/core"` and resolve `@/core/...` to `./src/core/...` —
  // a directory that does not exist. Longest-prefix-first is what makes the shared
  // aliases work. `createNodeConfig` PREPENDS these to its own `@deployer/*` rules.
  alias: [
    // Shared internals. Every app writes `@/core/*`, `@/config/*` and `@/auth`;
    // this is the same remap the app tsconfig declares, so a module moved between
    // apps needs no import change.
    { find: "@/core", replacement: path.resolve(__dirname, "../shared/src/core") },
    { find: "@/config", replacement: path.resolve(__dirname, "../shared/src/config") },
    { find: "@/auth", replacement: path.resolve(__dirname, "../shared/src/auth.ts") },
    // The shared e2e harness. Without this rule the import falls through to
    // `./src/e2e-harness`, which does not exist in a service, and the e2e spec
    // fails at COLLECTION time rather than at the import that is actually wrong.
    { find: "@/e2e-harness", replacement: path.resolve(__dirname, "../shared/src/e2e-harness") },
    // When vitest runs under Node (the VS Code extension), `bun:` protocol
    // imports cannot resolve. Alias `bun:sqlite` to the node:sqlite-backed shim so
    // drizzle-orm/bun-sqlite and local-db-supervisor tests still work there.
    ...(IS_BUN_RUNTIME
      ? []
      : [{ find: "bun:sqlite", replacement: path.resolve(__dirname, "../../api/vitest-shims/bun-sqlite.ts") }]),
  ],
  // Force one zod instance. Workspace packages may lack the `zod/v4` subpath
  // export, so without this the same schema can load twice and fail an
  // `instanceof` check.
  dedupe: ["zod"],
};

export default defineConfig(
  createNodeConfig({
    esbuild: false,
    // Use the SWC transformer rather than oxc to sidestep `zod/v4` export
    // resolution issues.
    oxc: false,
    plugins: [
      swc.vite({
        jsc: {
          target: "es2022",
          parser: { syntax: "typescript", decorators: true },
          transform: { legacyDecorator: true, decoratorMetadata: true },
        },
      }),
    ],
    test: {
      // ── WHY DEPS ARE INLINED ───────────────────────────────────────────────
      // `zod/v4` is a SUBPATH export that vite-node otherwise externalises, so a
      // dependency that imports `zod/v4` at module scope gets `undefined` back and
      // dies on the first `z.object(...)` with
      // `TypeError: undefined is not an object (evaluating 'z.object')` — naming
      // the file that called it, never the resolution that failed. Inlining makes
      // vite transform the dependency graph so the subpath resolves. This mirrors
      // `apps/api`, which sets the same flag for the same reason.
      server: {
        deps: {
          inline: true,
        },
      },
      // ── WHY `projects` AND NOT A WIDER INCLUDE ─────────────────────────────
      // The unit include below is what was already here and is left alone: those
      // suites pass with it. It simply does not reach `*.e2e-spec.ts` — the last
      // two segments are `e2e-spec` and `ts`, so `*.spec.ts` does not apply — which
      // is why the e2e specs were collected by nothing and the suite reported green
      // without running them. An explicit second project makes the e2e inclusion
      // visible instead of implied by a glob that quietly misses.
      projects: [
        {
          extends: true,
          // `extends: true` inherits `test` but NOT `resolve`, so the alias block
          // is repeated here — the project would otherwise lose `@/core/*` and the
          // `@deployer/*` source aliases the moment the root block drifted.
          resolve: TEST_RESOLVE,
          test: {
            name: "unit",
            environment: "node",
            globals: true,
            include: ["src/**/*.{test,spec}.{ts,tsx}"],
            exclude: ["node_modules", "dist", "src/**/*.e2e-spec.ts"],
            testTimeout: 15000,
            hookTimeout: 15000,
          },
        },
        {
          extends: true,
          resolve: TEST_RESOLVE,
          test: {
            name: "e2e",
            environment: "node",
            globals: true,
            // ── WHY `env` AND NOT ONLY THE SETUP FILE ───────────────────────
            // `setupFiles` runs AFTER vitest loads the spec's imports, and the e2e
            // harness imports the composed contract as a VALUE, whose module graph
            // parses the env schema. That parse applies the default
            // `NODE_LOCAL_DB_PATH=/app/data/local.db` — the path INSIDE the
            // container — and writes it into `process.env`, so an assignment in the
            // setup file is too late to win. On any non-container machine the
            // local-SQLite factory then dies with
            // `EACCES: permission denied, mkdir '/app/data'`.
            //
            // `test.env` is applied to the worker BEFORE any import, so the correct
            // path is present when the schema is first parsed.
            env: {
              NODE_LOCAL_DB_PATH: "/tmp/deployer-bff-e2e-local.db",
            },
            // Referenced from `apps/api`, not copied: their own imports are
            // relative to their own directory, so a copy per app would be six
            // identical files to keep in step.
            globalSetup: ["../../api/vitest.global-setup.e2e.ts"],
            setupFiles: ["../../api/vitest.setup.e2e.ts"],
            include: ["src/**/*.e2e-spec.ts"],
            exclude: ["node_modules", "dist"],
            testTimeout: 120000,
            hookTimeout: 120000,
          },
        },
      ],
    },
    resolve: TEST_RESOLVE,
  } as ViteUserConfigExport),
);
