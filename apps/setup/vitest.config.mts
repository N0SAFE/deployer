import { defineConfig } from "vitest/config";
import { createNodeConfig } from "@repo/config-vitest/node";
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
    esbuild: false,
    plugins: [],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    test: {
      globals: true,
      environment: "node",
      include: ["src/**/*.spec.ts"],
      exclude: ["node_modules", "dist"],
    },
  }),
);
