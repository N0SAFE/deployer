import { defineConfig } from "vitest/config";
import { createNodeConfig } from "@deployer/config-vitest/node";
import swc from "unplugin-swc";
import * as path from "path";

/**
 * The setup app's test config.
 *
 * Deliberately minimal compared to `apps/api`: the setup app has no e2e
 * harness, no shared Postgres container, and no SSR bundle under test. Only the
 * readiness gate and the wizard's server-side logic are covered here.
 */
export default defineConfig(
  createNodeConfig({
    // `esbuild: false` + the SWC plugin below: NestJS relies on LEGACY
    // decorators with metadata, which esbuild's transform does not emit. Vitest
    // therefore cannot even PARSE a decorated class without this, and the
    // module-graph spec would fail before it could report anything about the
    // graph. The settings mirror `apps/api/vitest.config.mts` exactly so both
    // apps transform decorators the same way.
    esbuild: false,
    oxc: false,
    plugins: [
      swc.vite({
        jsc: {
          target: "es2022",
          parser: {
            syntax: "typescript",
            decorators: true,
          },
          transform: {
            legacyDecorator: true,
            decoratorMetadata: true,
          },
        },
      }),
    ],
    resolve: {
      alias: {
        // ── ORDER IS LOAD-BEARING: MOST SPECIFIC FIRST ────────────────────────
        // Vite resolves aliases in DECLARATION order and takes the first PREFIX
        // match, so the bare `@` below would otherwise swallow every `@/…` path
        // and rewrite it into THIS app's `src` — which is why an earlier attempt
        // at this mapping changed nothing: the entry existed but was never
        // reached.
        //
        // `@deployer/contracts-entities` resolves to that package's `src`
        // DIRECTORY (see below), so its files are transpiled HERE rather than
        // consumed from `dist`. Its own sources use the package-internal alias
        // `@/entities/…`, which only ITS tsconfig defines. Unmapped, any spec
        // that reaches the package dies at LOAD time with
        //
        //   Error: Cannot find package '@/entities/configuration/index'
        //     imported from …/packages/contracts/entities/src/index.ts
        //
        // — a module-resolution failure, not a failed assertion, so the file
        // reports as `FAIL` with zero tests run and nothing inside it executes.
        "@/entities": path.resolve(__dirname, "../../packages/contracts/entities/src/entities"),
        "@/contracts": path.resolve(__dirname, "../../packages/contracts/entities/src/contracts"),
        "@/types": path.resolve(__dirname, "../../packages/contracts/entities/src/types"),
        "@": path.resolve(__dirname, "./src"),
        // Workspace packages resolve to their `src` DIRECTORY (not index.ts) so
        // deep subpaths keep working — the same convention as apps/api.
        "@deployer/nest-env": path.resolve(__dirname, "../../packages/nest/env/src"),
        "@deployer/env": path.resolve(__dirname, "../../packages/config/env/src"),
        "@deployer/errors": path.resolve(__dirname, "../../packages/utils/errors/src"),
        "@deployer/logger": path.resolve(__dirname, "../../packages/infrastructure/logger/src"),
        // The module-graph spec loads `WizardModule`, which imports the shared
        // wizard UI. That drags the whole `@deployer/ui` tree (and its contracts)
        // into the test graph, so those packages must resolve to `src` — from
        // `dist` they would be a stale build, and `zod` would resolve from
        // THEIR node_modules, where the `zod/v4` subpath is absent. That is the
        // exact failure `dedupe` below prevents.
        "@deployer/ui": path.resolve(__dirname, "../../packages/ui/base/src"),
        "@deployer/auth": path.resolve(__dirname, "../../packages/auth/src"),
        "@deployer/bff-contracts": path.resolve(__dirname, "../../packages/contracts/bff"),
        "@deployer/contracts-entities": path.resolve(__dirname, "../../packages/contracts/entities/src"),
        "@deployer/orpc-utils": path.resolve(__dirname, "../../packages/transport/orpc/src"),
        "@deployer/nest-docker": path.resolve(__dirname, "../../packages/nest/docker/src"),
        "@deployer/nest-nodes": path.resolve(__dirname, "../../packages/nest/nodes/src"),
        "@deployer/nest-swarm": path.resolve(__dirname, "../../packages/nest/swarm/src"),
        "@deployer/nest-schema": path.resolve(__dirname, "../../packages/nest/schema/src"),
        "@deployer/nest-database-local": path.resolve(__dirname, "../../packages/nest/database-local/src"),
      },
      // Force zod from THIS app's node_modules. Workspace packages do not all
      // re-export the `zod/v4` subpath, so without this a package that imports
      // `zod/v4` resolves to a copy where `z.object` is undefined.
      dedupe: ["zod"],
    },
    test: {
      server: {
        deps: {
          // Transform dependencies through the SAME pipeline as the test's own
          // modules. Without this vitest externalizes them and they are loaded
          // by Node's ESM loader instead, where `zod` — pulled in by the shared
          // wizard UI — resolves through its `@zod/source` condition to a
          // TypeScript file, so `z` is undefined and `z.object(...)` throws at
          // module scope. `apps/api` sets this for the same reason.
          inline: true,
        },
      },
      // Runs before any module import, so the env schema sees the test values
      // when it parses `process.env` at load — including the SQLite path, whose
      // production default (`/app/data/local.db`) does not exist outside a
      // container.
      setupFiles: ["./vitest.setup.ts"],
      globals: true,
      environment: "node",
      include: ["src/**/*.spec.ts"],
      exclude: ["node_modules", "dist"],
    },
  }),
);
