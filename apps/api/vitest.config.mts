import { defineConfig, ViteUserConfigExport } from "vitest/config";
import * as path from "path";
import { createNodeConfig } from "@deployer/config-vitest/node";
import swc from "unplugin-swc";

const E2E_MAX_CONCURRENCY = Number.parseInt(
  process.env.E2E_MAX_CONCURRENCY ?? "4",
  10,
);
const RESOLVED_E2E_MAX_CONCURRENCY =
  Number.isFinite(E2E_MAX_CONCURRENCY) && E2E_MAX_CONCURRENCY > 0
    ? E2E_MAX_CONCURRENCY
    : 4;

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}
// Shared runtime concurrency must be independent from vitest worker pool size.
// A single worker may need multiple runtimes (e.g. multi-node mesh tests need 3).
// Prioritize explicit env override, then fall back to a safe default of 4.
const RESOLVED_SHARED_RUNTIME_MAX_CONCURRENCY = (() => {
  const env = process.env.E2E_SHARED_RUNTIME_MAX_CONCURRENCY;
  if (env) {
    const parsed = Number.parseInt(env, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  // Default: 4 concurrent shared runtimes per worker (enough for multi-node tests)
  return 4;
})();
process.env.E2E_SHARED_RUNTIME_MAX_CONCURRENCY = String(
  RESOLVED_SHARED_RUNTIME_MAX_CONCURRENCY,
);

const IS_BUN_RUNTIME = Boolean(process.versions.bun);

// Enable globalSetup (shared Postgres container) by default.
// Previously this was disabled under Bun due to env var propagation concerns.
// With the temp-file IPC fallback in vitest.shared-postgres.e2e.ts, this is now
// safe and significantly reduces resource usage (1 container instead of N workers).
// Set E2E_DISABLE_GLOBAL_POSTGRES=true to revert to per-worker containers.
const DISABLE_GLOBAL_POSTGRES = isTruthyEnv(
  process.env.E2E_DISABLE_GLOBAL_POSTGRES,
);

export default defineConfig(
  createNodeConfig({
    esbuild: false,
    oxc: false, // Use SWC transformer instead to avoid zod/v4 export resolution issues
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
    test: {
      server: {
        deps: {
          inline: true
        }
      },
      coverage: {
        provider: "istanbul",
        reporter: ["text", "json", "html"],
        reportsDirectory: "./coverage",
        clean: true,
        thresholds: {
          global: {
            branches: 90,
            functions: 90,
            lines: 90,
            statements: 90,
          },
        },
        exclude: [
          "coverage/**",
          "dist/**",
          "node_modules/**",
          "**/*.d.ts",
          "**/drizzle/**",
          "**/migrations/**",
          "src/main.ts",
          "**/*.config.*",
          "**/symbols.ts",
          "**/index.ts",
        ],
      },
      projects: [
        {
          extends: true,
          test: {
            name: "unit",
            environment: "node",
            setupFiles: ["./vitest.setup.ts"],
            include: ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}"],
            exclude: [
              "node_modules",
              "dist",
              "uploads",
              "database",
              "drizzle",
              "src/**/*.e2e-spec.ts",
            ],
            globals: true,
            testTimeout: 15000,
            hookTimeout: 15000,
          },
        },
        {
          extends: true,
          test: {
            name: "e2e",
            environment: "node",
            // ── WHY `env` AND NOT ONLY THE SETUP FILE ───────────────────────
            // The env schema defaults `NODE_LOCAL_DB_PATH` to `/app/data/local.db`,
            // the path INSIDE the container. `vitest.setup.e2e.ts` does override it,
            // but `setupFiles` runs AFTER vitest has loaded the spec's imports, and
            // those imports reach `@/core/orpc/app-contract`, whose module graph
            // parses the env schema and writes the container path into
            // `process.env`. The later assignment then has nothing to correct.
            //
            // On any machine that is not the container, the local-SQLite factory
            // tries to create `/app/data` and dies with
            // `EACCES: permission denied, mkdir '/app/data'`, failing the suite at
            // collection time rather than at the assertion that matters.
            //
            // `test.env` is applied to the worker BEFORE any import, so the correct
            // path is in place when the schema is first parsed. The setup file keeps
            // its own assignment as a second line of defence for a direct vitest
            // invocation that bypasses this config.
            env: {
              NODE_LOCAL_DB_PATH: "/tmp/deployer-api-e2e-local.db",
            },
            globalSetup: DISABLE_GLOBAL_POSTGRES
              ? ["./vitest.global-setup.noop.e2e.ts"]
              : ["./vitest.global-setup.e2e.ts"],
            setupFiles: ["./vitest.setup.e2e.ts"],
            // NOTE: vitest has no globalTeardown hook — teardown is wired by
            // vitest.global-setup.e2e.ts returning the closure from
            // vitest.teardown.e2e.ts.
            include: ["src/**/*.e2e-spec.ts"],
            exclude: ["node_modules", "dist", "uploads", "database", "drizzle"],
            globals: true,
            testTimeout: 120000,
            hookTimeout: 120000,
            maxConcurrency: RESOLVED_E2E_MAX_CONCURRENCY,
            // Every e2e file imports and compiles the full AppModule (~1.5 GB each),
            // so a worker per core exhausts memory and the 45s import watchdog trips
            // on swap thrash rather than on a real hang. Override with E2E_MAX_WORKERS.
            maxWorkers: Number.parseInt(process.env.E2E_MAX_WORKERS ?? "3", 10) || 3,
            // Vitest requires projects with different `maxWorkers` to run in separate groups.
            sequence: { groupOrder: 1 },
          },
        },
      ],
    },
    resolve: {
      alias: {

        // ── MOST SPECIFIC ALIASES FIRST ───────────────────────────────
        // Vite resolves aliases in DECLARATION order and takes the first PREFIX
        // match, so the bare `@` below would swallow every `@/…` path and rewrite
        // it into THIS app's `src`. These three therefore MUST precede it.
        //
        // `@deployer/contracts-entities` resolves to that package's `src`
        // DIRECTORY (further down), so its files are transpiled by THIS app's
        // vitest. Its sources import `@/entities/…`, `@/contracts/…` and
        // `@/types/…` — aliases only that package's own tsconfig defines.
        // Unmapped, any spec that reaches the package fails at LOAD time with
        //
        //   Error: Cannot find package '@/entities/configuration/index'
        //     imported from …/packages/contracts/entities/src/index.ts
        //
        // — a module-resolution failure, so the file reports FAIL with ZERO tests
        // run and nothing inside it executes. Three provider specs were failing
        // this way before these entries existed.
        "@/entities": path.resolve(__dirname, "../../packages/contracts/entities/src/entities"),
        "@/contracts": path.resolve(__dirname, "../../packages/contracts/entities/src/contracts"),
        "@/types": path.resolve(__dirname, "../../packages/contracts/entities/src/types"),
        "@": path.resolve(__dirname, "./src"),
        "~": path.resolve(__dirname, "./"),
        // Workspace packages resolve to their `src` **directory**. Code imports
        // deep subpaths (e.g. `@deployer/orpc-utils/builder/core/route-builder`), so
        // the alias must map the package name to a directory — mapping to
        // `${pkg}/src/index.ts` leaves subpaths to fall through to `dist/`,
        // which tests must not load.
        //
        // GENERATED from this app's `package.json`. Do not hand-edit: run
        // `python3 scripts/sync-api-vitest-aliases.py` after adding a dependency.
        "@deployer/auth": path.resolve(__dirname, "../../packages/auth/src"),
        "@deployer/bff-contracts": path.resolve(__dirname, "../../packages/contracts/bff"),
        "@deployer/config-eslint": path.resolve(__dirname, "../../tooling/eslint/src"),
        "@deployer/config-prettier": path.resolve(__dirname, "../../tooling/prettier/src"),
        "@deployer/config-tailwind": path.resolve(__dirname, "../../tooling/tailwind"),
        "@deployer/config-typescript": path.resolve(__dirname, "../../tooling/typescript"),
        "@deployer/config-vitest": path.resolve(__dirname, "../../tooling/vitest/src"),
        "@deployer/contracts-common": path.resolve(__dirname, "../../packages/contracts/common/src"),
        "@deployer/contracts-entities": path.resolve(__dirname, "../../packages/contracts/entities/src"),
        "@deployer/env": path.resolve(__dirname, "../../packages/config/env/src"),
        "@deployer/errors": path.resolve(__dirname, "../../packages/utils/errors/src"),
        "@deployer/fleet-contracts": path.resolve(__dirname, "../../packages/contracts/fleet"),
        "@deployer/health-contracts": path.resolve(__dirname, "../../packages/contracts/health"),
        "@deployer/identity-contracts": path.resolve(__dirname, "../../packages/contracts/identity"),
        "@deployer/logger": path.resolve(__dirname, "../../packages/infrastructure/logger/src"),
        "@deployer/mesh-network": path.resolve(__dirname, "../../packages/infrastructure/mesh-network/src"),
        "@deployer/nest-database-core": path.resolve(__dirname, "../../packages/nest/database-core/src"),
        "@deployer/nest-database-local": path.resolve(__dirname, "../../packages/nest/database-local/src"),
        "@deployer/nest-docker": path.resolve(__dirname, "../../packages/nest/docker/src"),
        "@deployer/nest-env": path.resolve(__dirname, "../../packages/nest/env/src"),
        "@deployer/nest-events": path.resolve(__dirname, "../../packages/nest/events/src"),
        "@deployer/nest-lifecycle": path.resolve(__dirname, "../../packages/nest/lifecycle/src"),
        "@deployer/nest-nodes": path.resolve(__dirname, "../../packages/nest/nodes/src"),
        "@deployer/nest-reachability": path.resolve(__dirname, "../../packages/nest/reachability/src"),
        "@deployer/nest-schema": path.resolve(__dirname, "../../packages/nest/schema/src"),
        "@deployer/nest-supervisor-core": path.resolve(__dirname, "../../packages/nest/supervisor-core/src"),
        "@deployer/nest-swarm": path.resolve(__dirname, "../../packages/nest/swarm/src"),
        "@deployer/orpc-utils": path.resolve(__dirname, "../../packages/transport/orpc/src"),
        "@deployer/project-contracts": path.resolve(__dirname, "../../packages/contracts/project"),
        "@deployer/provider-schema": path.resolve(__dirname, "../../packages/utils/provider-schema/src"),
        "@deployer/runtime-contracts": path.resolve(__dirname, "../../packages/contracts/runtime"),
        "@deployer/type-guards": path.resolve(__dirname, "../../packages/utils/type-guards/src"),
        "@deployer/ui": path.resolve(__dirname, "../../packages/ui/base/src"),
        "@deployer/vite-assets": path.resolve(__dirname, "../../packages/utils/vite-assets/src"),
        // When vitest runs under Node (VS Code extension), bun: protocol imports
        // cannot resolve. Alias bun:sqlite to our node:sqlite-backed shim so
        // drizzle-orm/bun-sqlite and local-db-supervisor tests work in Node.
        ...(IS_BUN_RUNTIME
          ? {}
          : {
              "bun:sqlite": path.resolve(__dirname, "./vitest-shims/bun-sqlite.ts"),
            }),
      },
      // Force zod to be resolved from the API's node_modules rather than
      // from workspace packages (which may lack the zod/v4 subpath export).
      dedupe: ["zod"],
    },
  } as ViteUserConfigExport),
);
