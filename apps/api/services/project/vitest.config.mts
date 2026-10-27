import path from "node:path";
import { createServiceTestConfig } from "@deployer/config-vitest/service";

/**
 * The project app's test config. Everything shared — the SWC decorator transform, the
 * `@/core` aliases, the unit/e2e projects — lives in
 * `@deployer/config-vitest/service`, so this file is only what is specific to project.
 */
export default createServiceTestConfig({
	service: "project",
	extraAliases: [
		{ find: "@project", replacement: path.resolve(import.meta.dirname, "src") },
	],
});
