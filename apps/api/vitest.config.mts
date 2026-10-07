import { defineConfig, ViteUserConfigExport } from "vitest/config";
import * as path from "path";
import { createNodeConfig } from "@repo/config-vitest/node";
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
            include: ["**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}"],
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
          },
        },
      ],
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "~": path.resolve(__dirname, "./"),
        // Workspace packages resolve to their `src` **directory**. Code imports
        // deep subpaths (e.g. `@repo/orpc-utils/builder/core/route-builder`), so
        // the alias must map the package name to a directory — mapping to
        // `${pkg}/src/index.ts` leaves subpaths to fall through to `dist/`,
        // which tests must not load.
        "@repo/auth": path.resolve(__dirname, "../../packages/auth/src"),
        "@repo/api-contracts": path.resolve(__dirname, "../../packages/contracts/api"),
        "@repo/contracts-common": path.resolve(__dirname, "../../packages/contracts/common/src"),
        "@repo/contracts-entities": path.resolve(__dirname, "../../packages/contracts/entities/src"),
        "@repo/env": path.resolve(__dirname, "../../packages/config/env/src"),
        "@repo/errors": path.resolve(__dirname, "../../packages/utils/errors/src"),
        "@repo/logger": path.resolve(__dirname, "../../packages/infrastructure/logger/src"),
        "@repo/nest-events": path.resolve(__dirname, "../../packages/nest/events/src"),
        "@repo/nest-env": path.resolve(__dirname, "../../packages/nest/env/src"),
        "@repo/nest-database-core": path.resolve(__dirname, "../../packages/nest/database-core/src"),
        "@repo/nest-docker": path.resolve(__dirname, "../../packages/nest/docker/src"),
        "@repo/nest-supervisor-core": path.resolve(__dirname, "../../packages/nest/supervisor-core/src"),
        "@repo/nest-swarm": path.resolve(__dirname, "../../packages/nest/swarm/src"),
        "@repo/nest-database-local": path.resolve(__dirname, "../../packages/nest/database-local/src"),
        "@repo/nest-nodes": path.resolve(__dirname, "../../packages/nest/nodes/src"),
        "@repo/nest-reachability": path.resolve(__dirname, "../../packages/nest/reachability/src"),
        "@repo/nest-schema": path.resolve(__dirname, "../../packages/nest/schema/src"),
        "@repo/nest-lifecycle": path.resolve(__dirname, "../../packages/nest/lifecycle/src"),
        "@repo/orpc-utils": path.resolve(__dirname, "../../packages/transport/orpc/src"),
        "@repo/provider-schema": path.resolve(__dirname, "../../packages/utils/provider-schema/src"),
        "@repo/type-guards": path.resolve(__dirname, "../../packages/utils/type-guards/src"),
        "@repo/types": path.resolve(__dirname, "../../packages/types/src"),
        "@repo/ui": path.resolve(__dirname, "../../packages/ui/base/src"),
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
