import { defineConfig } from "vitest/config";
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
              "src/app.module.spec.ts",
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
            globalTeardown: ["./vitest.teardown.e2e.ts"],
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
      },
    },
  }),
);
