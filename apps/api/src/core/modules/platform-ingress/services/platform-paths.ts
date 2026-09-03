/**
 * Shared deterministic paths for the platform-ingress bounded context.
 * Both supervisors derive identical locations — never duplicate this grammar.
 */

import path from "node:path";

export const PlatformPaths = {
	/** Host directory holding builder-generated dynamic configs. */
	configDir(configBasePath: string, prefix: string): string {
		return prefix === "" ? path.join(configBasePath, "platform") : path.join(configBasePath, `platform-${prefix}`);
	},
	/** Per-owner dynamic config files inside the watched dir. */
	apiConfigFile(configDir: string): string {
		return path.join(configDir, "dynamic-api.yml");
	},
	webConfigFile(configDir: string): string {
		return path.join(configDir, "dynamic-web.yml");
	},
	/** Owner file for DB-driven domain routes (global hostname, tunnel,
	 *  deployments, previews) — written by the Traefik supervisor. */
	domainConfigFile(configDir: string): string {
		return path.join(configDir, "dynamic-domain.yml");
	},
};
