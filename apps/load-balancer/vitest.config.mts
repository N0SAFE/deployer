import { defineConfig } from "vitest/config";
import * as path from "path";
import { createNodeConfig } from "@repo/config-vitest/node";

export default defineConfig(
    createNodeConfig({
        test: {
            name: "load-balancer",
            environment: "node",
            setupFiles: ["./vitest.setup.ts"],
            include: ["**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}"],
            exclude: ["node_modules", "dist"],
            globals: true,
        },
        resolve: {
            alias: {
                "@": path.resolve(__dirname, "./src"),
                "~": path.resolve(__dirname, "./"),
            },
        },
    }),
);