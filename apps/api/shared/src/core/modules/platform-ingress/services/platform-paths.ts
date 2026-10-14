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
	/**
	 * Owner file for the ONBOARDING hostname.
	 *
	 * Setup writes `dynamic-setup.yml` while it runs, because it is the only
	 * process that exists then. It is not the process that survives, though — so
	 * once it exits, THIS builder becomes the file's owner and repoints
	 * `setup.<host>` at the API's own landing page. Without that takeover the
	 * file keeps naming the dead `http://setup:3016` backend and every reload of
	 * the wizard URL returns 502 forever.
	 */
	setupConfigFile(configDir: string): string {
		return path.join(configDir, "dynamic-setup.yml");
	},
	/** Owner file for DB-driven domain routes (global hostname, tunnel,
	 *  deployments, previews) — written by the Traefik supervisor. */
	domainConfigFile(configDir: string): string {
		return path.join(configDir, "dynamic-domain.yml");
	},
};
