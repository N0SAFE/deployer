import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        coverage: {
            provider: "v8",
            reporter: ["text", "json", "html"],
            exclude: ["node_modules/**", "dist/**", "**/*.config.*", "**/*.d.ts", "**/index.ts"],
        },
    },
    // Mirrors the tsconfig `@/*` → `./src/*` mapping so unit tests exercise the
    // same specifiers the source uses.
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
});