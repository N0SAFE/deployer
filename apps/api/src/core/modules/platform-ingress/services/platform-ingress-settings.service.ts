/**
 * PlatformIngressSettingsService — persisted settings for the platform ingress
 * (Traefik) in the LOCAL SQLite database.
 *
 * The ENTRY PORT lives in the local `platform_settings` table (survives
 * restarts, available before Postgres) and OVERRIDES the env default. The web
 * UI can change it at runtime ("set the entry port in the settings") — the
 * Traefik supervisor picks it up and recreates the container on the assigned
 * port.
 *
 * GLOBAL NETWORK (domain + tunnel) is NOT stored here — it lives in the global
 * `node_network_config` table (reachability domain, `ReachabilityService` /
 * `appContract.reachability.*`), which already provisions Cloudflare tunnels.
 * This service only exposes the ENTRY PORT.
 */

import { Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { LocalDatabaseService } from "@/core/modules/database/local/local-database.service";
import { EnvService } from "@/config/env/env.service";
import { platformSettings } from "@/config/drizzle/local/schema";

/** Local settings key — the host port the platform Traefik publishes. */
export const INGRESS_ENTRY_PORT_KEY = "ingress.entry_port";

export interface PlatformEntry {
	/** Host port the platform Traefik publishes (default 80). */
	port: number;
	/** True when the port is the default 80 (global domains / plain DNS work). */
	isDefault80: boolean;
	/** Where the value came from: the local settings DB or the env default. */
	sourcedFrom: "local-db" | "env" | "default";
}

@Injectable()
export class PlatformIngressSettingsService {
	private readonly logger = new Logger(PlatformIngressSettingsService.name);

	constructor(
		private readonly localDb: LocalDatabaseService,
		private readonly env: EnvService,
	) {}

	/** Resolve the current platform entry (settings DB wins over env; default 80). */
	async getPlatformEntry(): Promise<PlatformEntry> {
		const stored = await this.getEntryPortFromDb();
		if (stored !== null) {
			return { port: stored, isDefault80: stored === 80, sourcedFrom: "local-db" };
		}
		const envPort = this.env.get("DEPLOYER_TRAEFIK_HTTP_PORT");
		return { port: envPort, isDefault80: envPort === 80, sourcedFrom: envPort === 80 ? "default" : "env" };
	}

	/** The configured entry port (DB override, else env default 80). */
	async getEntryPort(): Promise<number> {
		return (await this.getPlatformEntry()).port;
	}

	/** Persist a new entry port in the local settings. */
	async setEntryPort(port: number): Promise<void> {
		const effective = Math.min(65_535, Math.max(1, Math.floor(port)));
		await this.upsert(INGRESS_ENTRY_PORT_KEY, String(effective));
		this.logger.log(`Platform ingress entry port set to ${String(effective)} (local settings)`);
	}

	/** Clear the stored entry port (back to env default 80). */
	async clearEntryPort(): Promise<void> {
		try {
			await this.localDb.db.delete(platformSettings).where(eq(platformSettings.key, INGRESS_ENTRY_PORT_KEY)).run();
			this.logger.log("Platform ingress entry port reset to env default");
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to clear platform ingress entry port: ${msg}`);
		}
	}

	/** Entry port from the local settings table. */
	private async getEntryPortFromDb(): Promise<number | null> {
		try {
			const rows = this.localDb.db.select().from(platformSettings).where(eq(platformSettings.key, INGRESS_ENTRY_PORT_KEY)).limit(1).all();
			const row = rows[0];
			if (row === undefined) return null;
			const parsed = Number.parseInt(row.value, 10);
			if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65_535) {
				this.logger.warn(`Invalid stored ingress.entry_port "${row.value}" — ignoring`);
				return null;
			}
			return parsed;
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			this.logger.warn(`Could not read platform_settings (may be mid-migration): ${msg}`);
			return null;
		}
	}

	private async upsert(key: string, value: string): Promise<void> {
		const now = new Date().toISOString();
		await this.localDb.db
			.insert(platformSettings)
			.values({ key, value, updatedAt: now })
			.onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: now } })
			.run();
	}
}