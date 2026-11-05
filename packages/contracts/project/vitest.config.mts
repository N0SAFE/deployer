import { defineConfig } from "vitest/config";
import { createNodeConfig } from "@deployer/config-vitest/node";

export default defineConfig(
    createNodeConfig({
        test: {
            globals: true,
            environment: "node",
            include: ["modules/**/*.{test,spec}.ts"],
            exclude: ["**/node_modules/**", "**/dist/**"],
        },
    }),
);
