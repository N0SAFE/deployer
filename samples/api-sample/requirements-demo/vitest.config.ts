import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		environment: "node",
		setupFiles: ["./src/test-setup.ts"],
		typecheck: {
			enabled: true,
			include: ["src/**/*.test-d.ts"],
			tsconfig: "./tsconfig.json",
		},
	},
});
