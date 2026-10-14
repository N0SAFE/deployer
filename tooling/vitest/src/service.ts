/// <reference types="vitest" />
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { defineConfig, type ViteUserConfigExport } from "vitest/config";
// eslint-disable-next-line @typescript-eslint/no-require-imports
import swc from "unplugin-swc";

import { createNodeConfig } from "./node.js";

/**
 * Test config for an `apps/api-services` app.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The BFF and the five services each carried a 143-line copy of the same config,
 * differing only in a comment, a name, and one SQLite path. Six copies of a
 * decorated-class transformer setup is six places to fix when vitest, SWC or the
 * alias scheme changes — and the copies had already drifted. Everything shared now
 * lives here; a service's own `vitest.config.mts` is the name and the path.
 *
 * The comments that explained WHY (not what) are kept below, because each one records
 * a failure that cost real time: the alias ordering, the missing decorator metadata,
 * the `zod/v4` subpath, and the e2e env timing.
 */

const IS_BUN_RUNTIME = Boolean(process.versions.bun);

/**
 * Absolute paths the aliases need, resolved by walking up to the workspace root.
 *
 * The apps are not all at the same depth — `api-services/bff` sits one level above
 * `api-services/services/<name>` — so a fixed `../..` would resolve `shared` to
 * `api-services/services/shared` for a service and `apps/shared` for the BFF. Walking
 * up until the layout is recognisable is depth-independent.
 */
function resolveWorkspacePaths(): { sharedSrc: string; apiRoot: string } {
    let dir = process.cwd();
    for (let i = 0; i < 6; i++) {
        const sharedSrc = path.join(dir, "apps/api-services/shared/src");
        const apiRoot = path.join(dir, "apps/api");
        if (isDirectory(sharedSrc) && isDirectory(apiRoot)) return { sharedSrc, apiRoot };
        dir = path.dirname(dir);
    }
    throw new Error(
        `@deployer/config-vitest: could not locate apps/api-services/shared/src and apps/api ` +
            `by walking up from ${process.cwd()}`,
    );
}

function isDirectory(p: string): boolean {
    try {
        return statSync(p).isDirectory();
    } catch {
        return false;
    }
}

export interface ServiceTestConfigOptions {
    /** The service name, used for the project names and the e2e SQLite path. */
    readonly service: string;
}

/**
 * `createServiceTestConfig("identity")` — the whole test config for a service app.
 */
export const createServiceTestConfig = (
    options: ServiceTestConfigOptions,
): ViteUserConfigExport => {
    const { service } = options;
    const { sharedSrc: SHARED_SRC, apiRoot: API_ROOT } = resolveWorkspacePaths();
    const appSrc = path.resolve(process.cwd(), "src");

    // ── THE ARRAY FORM, AND THE ORDER IS THE POINT ────────────────────────────
    // An OBJECT alias is matched by prefix with no guaranteed specificity order, so
    // `"@"` can win over `"@/core"` and resolve `@/core/...` to `./src/core/...`, which
    // is a directory that does not exist. Longest-prefix-first is what makes the shared
    // aliases work. `createNodeConfig` PREPENDS these to its own `@deployer/*` rules.
    //
    // This mirrors the app's own `tsconfig.json` `paths` exactly: `@/*` is the app's
    // own `src/*`, and the shared internals get NARROW entries. Widening `@/` to the
    // shared root or to `apps/api/src` would let `@/modules/user` resolve to the
    // monolith's copy instead of this service's, so a test would silently exercise
    // different code than the app ships.
    const sharedAlias = [
        { find: "@/core", replacement: path.resolve(SHARED_SRC, "core") },
        { find: "@/config", replacement: path.resolve(SHARED_SRC, "config") },
        { find: "@/auth", replacement: path.resolve(SHARED_SRC, "auth.ts") },
        // The shared e2e harness. Without this the import falls through to
        // `./src/e2e-harness`, which does not exist in a service, and the spec fails at
        // COLLECTION time rather than at the import that is actually wrong.
        { find: "@/e2e-harness", replacement: path.resolve(SHARED_SRC, "e2e-harness") },
        // Under Node (the VS Code extension) `bun:` protocol imports cannot resolve.
        // Aliasing `bun:sqlite` to the node:sqlite shim keeps drizzle-orm/bun-sqlite
        // and the local-db supervisor tests working there.
        ...(IS_BUN_RUNTIME
            ? []
            : [
                  {
                      find: "bun:sqlite",
                      replacement: path.resolve(API_ROOT, "vitest-shims/bun-sqlite.ts"),
                  },
              ]),
    ];

    // Force one zod instance: workspace packages may lack the `zod/v4` subpath export,
    // so without this the same schema can load twice and fail an `instanceof` check.
    //
    // The catch-all comes LAST so the shared prefixes above win, and points at the
    // app's own `src` — the same target the tsconfig declares for `@/*`.
    const appAlias = [{ find: /^@\//, replacement: appSrc + "/" }];

    const resolveConfig = { alias: [...sharedAlias, ...appAlias], dedupe: ["zod"] };

    // `createNodeConfig` aliases every `@deployer/*` workspace package to its `src`
    // directory. That is not cosmetic: packages publish `exports` whose runtime targets
    // are `dist/**`, so without the alias an import of `@deployer/orpc-utils/builder/x`
    // would load the BUILT copy while a sibling imports the SOURCE. Two module instances
    // break shared state and circular init.
    //
    // `esbuild: false` + SWC because NestJS depends on LEGACY decorators with
    // `emitDecoratorMetadata`, which esbuild's transform does not emit — vitest could not
    // even PARSE a decorated class without this.
    return defineConfig(
        createNodeConfig({
            esbuild: false,
            // SWC rather than oxc, to sidestep `zod/v4` export resolution issues.
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
                // ── WHY DEPS ARE INLINED ───────────────────────────────────────
                // `zod/v4` is a SUBPATH export that vite-node otherwise externalises, so a
                // dependency importing `zod/v4` at module scope gets `undefined` back and
                // dies on the first `z.object(...)` with a TypeError naming the caller,
                // never the resolution. Inlining makes vite transform the dependency graph
                // so the subpath resolves. Mirrors `apps/api`.
                server: { deps: { inline: true } },
                // ── WHY AN EXPLICIT e2e PROJECT ────────────────────────────────
                // `src/**/*.spec.ts` does not match `*.e2e-spec.ts` (the last two segments
                // are `e2e-spec` and `ts`), so e2e specs were collected by nothing and the
                // suite reported green without running them. An explicit second project
                // makes the e2e inclusion visible instead of implied by a glob that misses.
                projects: [
                    {
                        extends: true,
                        // `extends: true` inherits `test` but NOT `resolve`, so the alias
                        // block is repeated — the project would otherwise lose `@/core/*`
                        // and the `@deployer/*` source aliases.
                        resolve: resolveConfig,
                        test: {
                            name: `${service}-unit`,
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
                        resolve: resolveConfig,
                        test: {
                            name: `${service}-e2e`,
                            environment: "node",
                            globals: true,
                            // ── WHY `env` AND NOT ONLY THE SETUP FILE ──────────
                            // `setupFiles` runs AFTER vitest loads the spec's imports, and the
                            // e2e harness imports the composed contract as a VALUE, whose graph
                            // parses the env schema. That parse applies the default
                            // `NODE_LOCAL_DB_PATH=/app/data/local.db` — the path INSIDE the
                            // container — and CACHES it, so a setup-file assignment is too late
                            // to win. On any non-container machine the local-SQLite factory then
                            // dies with `EACCES: permission denied, mkdir '/app/data'`.
                            //
                            // `test.env` is applied to the worker BEFORE any import, so this
                            // placeholder is what the schema sees during that early parse. The
                            // e2e harness then re-points each RUNTIME at its own
                            // `deployer-api-e2e-<instanceKey>-<uuid>.db` — see
                            // `shared-api-runtime/manager.ts`, which is what keeps two specs in
                            // one worker off the same SQLite file. This value only has to be a
                            // writable path that is not the container's.
                            env: { NODE_LOCAL_DB_PATH: `/tmp/deployer-${service}-e2e-local.db` },
                            // ── WHY THE E2E PROJECT IS SERIAL ───────────────────
                            // The local SQLite file is a single path shared by every spec in
                            // this project, and two specs booting at once contend for it during
                            // migration: SQLite has one writer, and the loser fails with
                            // `database is locked` rather than waiting (the lock is taken by way
                            // of DDL, which `busy_timeout` does not retry).
                            //
                            // Per-runtime isolation is not available here: the harness DOES
                            // build an isolated database per runtime, but for SQLite it does so
                            // through `NODE_LOCAL_DB_PATH`, and that value is cached when the
                            // contract graph is first imported — BEFORE the harness runs. So
                            // every spec in the project ends up on the one path above.
                            //
                            // Postgres is unaffected (the harness creates one database per
                            // runtime), and the unit project stays parallel. E2E files are few
                            // and already boot a full Nest app, so serialising them costs
                            // little and makes the suite deterministic.
                            fileParallelism: false,
                            // Referenced from `apps/api`, not copied: their imports are relative
                            // to their own directory, so a copy per app would be six identical
                            // files to keep in step.
                            globalSetup: [path.resolve(API_ROOT, "vitest.global-setup.e2e.ts")],
                            setupFiles: [path.resolve(API_ROOT, "vitest.setup.e2e.ts")],
                            include: ["src/**/*.e2e-spec.ts"],
                            exclude: ["node_modules", "dist"],
                            testTimeout: 120000,
                            hookTimeout: 120000,
                        },
                    },
                ],
            },
            resolve: resolveConfig,
        } as ViteUserConfigExport),
    );
};
