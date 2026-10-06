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
 * GLOBAL NETWORK (the node's own public address) is NOT stored here — it lives
 * in the global `node_network_config` table (reachability domain), because a
 * node's address is a property of that node.
 *
 * THE STACK EDGE (tunnel token / tunnel id / wildcard) IS stored here. It used
 * to live per NODE in that same table, which meant one Cloudflare tunnel PER
 * NODE: N objects to create, N hostname rules to keep in sync, and N connectors
 * racing to answer for the same hostname. The edge is a property of the STACK —
 * one tunnel, many connectors (Cloudflare allows up to 25) — so it is stored
 * once, next to the entry port it is the alternative to.
 *
 * These stay LOCAL for the same reason the entry port does: the connector
 * supervisor must answer "is an edge configured?" during boot, before Postgres
 * is reachable.
 */

import { Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import z from "zod/v4";

import { LocalDatabaseService } from "@repo/nest-database-local/local-database.service";
import { EnvService } from "@/config/env/env.module";
import { platformSettings } from "@repo/nest-schema/local";

/** Local settings key — the host port the platform Traefik publishes. */
export const INGRESS_ENTRY_PORT_KEY = "ingress.entry_port";

/**
 * Local settings keys for the STACK edge tunnel.
 *
 * The token is a credential, so it is written through the API (never logged)
 * and read by the connector supervisor — nothing else needs it.
 */
export const EDGE_TUNNEL_TOKEN_KEY = "edge.tunnel_token";
export const EDGE_TUNNEL_ID_KEY = "edge.tunnel_id";
export const EDGE_TUNNEL_PROVIDER_ID_KEY = "edge.tunnel_provider_id";
export const EDGE_TUNNEL_WILDCARD_KEY = "edge.tunnel_wildcard";

/**
 * Local settings key for the edge mode.
 *
 * Persisted because the MODE is an operator decision the UI switches at
 * runtime, while `DEPLOYER_EDGE_MODE` is only the install-time default. Storing
 * it here keeps the two supervisors that must agree on it (Traefik publishes the
 * entry port, the connector dials out) reading ONE value instead of each
 * interpreting env on its own.
 */
export const EDGE_MODE_KEY = "edge.mode";

/** How the internet reaches the stack's ingress. */
export const edgeModeSchema = z.enum(["direct", "tunnel"]);
export type EdgeMode = z.output<typeof edgeModeSchema>;

/**
 * The stack's single tunnel, as persisted.
 *
 * `tunnelId` is stored alongside the token so a re-provision can REUSE (or
 * deliberately delete) the existing tunnel instead of creating a second one
 * that nothing points at — the failure the per-node model made routine.
 */
export interface EdgeTunnelSettings {
	/** Run token authorising a connector against the stack's tunnel. */
	token: string | null;
	/** Cloudflare tunnel id, so it is reused/deleted rather than duplicated. */
	tunnelId: string | null;
	/** DNS provider app owning the tunnel (`dns_providers.id`). */
	providerId: string | null;
	/** Wildcard the tunnel routes (e.g. `*.example.com`), when set. */
	wildcard: string | null;
}

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
		await this.deleteSetting(INGRESS_ENTRY_PORT_KEY);
		this.logger.log("Platform ingress entry port reset to env default");
	}

	/**
	 * The effective edge mode: the persisted operator choice, else the env default.
	 *
	 * An unparseable stored value falls back to env rather than throwing — a bad
	 * row must not take the ingress down, and env is a valid answer for it.
	 */
	async getEdgeMode(): Promise<EdgeMode> {
		const stored = await this.readSetting(EDGE_MODE_KEY);
		const parsed = edgeModeSchema.safeParse(stored);
		if (parsed.success) return parsed.data;
		if (stored !== null) {
			this.logger.warn(`Invalid stored edge.mode "${stored}" — falling back to DEPLOYER_EDGE_MODE`);
		}
		return this.env.get("DEPLOYER_EDGE_MODE");
	}

	/** Persist the operator's edge-mode choice. */
	async setEdgeMode(mode: EdgeMode): Promise<void> {
		await this.upsert(EDGE_MODE_KEY, mode);
		this.logger.log(`Edge mode set to '${mode}' (local settings)`);
	}

	/**
	 * The stack's tunnel credentials, or all-null when none is persisted.
	 *
	 * Never throws for a missing row: "no tunnel yet" is the normal state of a
	 * `direct` install, not an error.
	 */
	async getEdgeTunnel(): Promise<EdgeTunnelSettings> {
		return {
			token: await this.readSetting(EDGE_TUNNEL_TOKEN_KEY),
			tunnelId: await this.readSetting(EDGE_TUNNEL_ID_KEY),
			providerId: await this.readSetting(EDGE_TUNNEL_PROVIDER_ID_KEY),
			wildcard: await this.readSetting(EDGE_TUNNEL_WILDCARD_KEY),
		};
	}

	/**
	 * Persist the stack's tunnel. Every field is written together: a token whose
	 * tunnel id is missing is unrecoverable (nothing can delete or rotate it).
	 */
	async setEdgeTunnel(input: {
		token: string;
		tunnelId: string;
		providerId: string;
		wildcard?: string | null;
	}): Promise<void> {
		await this.upsert(EDGE_TUNNEL_TOKEN_KEY, input.token);
		await this.upsert(EDGE_TUNNEL_ID_KEY, input.tunnelId);
		await this.upsert(EDGE_TUNNEL_PROVIDER_ID_KEY, input.providerId);
		await this.upsert(EDGE_TUNNEL_WILDCARD_KEY, input.wildcard ?? "");
		// The token itself is NEVER logged — only the tunnel it belongs to.
		this.logger.log(`Stack edge tunnel ${input.tunnelId} stored (local settings)`);
	}

	/** Forget the stack's tunnel (the connector then has nothing to run). */
	async clearEdgeTunnel(): Promise<void> {
		for (const key of [
			EDGE_TUNNEL_TOKEN_KEY,
			EDGE_TUNNEL_ID_KEY,
			EDGE_TUNNEL_PROVIDER_ID_KEY,
			EDGE_TUNNEL_WILDCARD_KEY,
		]) {
			await this.deleteSetting(key);
		}
		this.logger.log("Stack edge tunnel cleared (local settings)");
	}

	/** Entry port from the local settings table. */
	private async getEntryPortFromDb(): Promise<number | null> {
		const raw = await this.readSetting(INGRESS_ENTRY_PORT_KEY);
		if (raw === null) return null;
		const parsed = Number.parseInt(raw, 10);
		if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65_535) {
			this.logger.warn(`Invalid stored ingress.entry_port "${raw}" — ignoring`);
			return null;
		}
		return parsed;
	}

	/**
	 * One settings row, or null when absent.
	 *
	 * A read failure is NOT an error: this table can be mid-migration during
	 * boot, and every caller has a documented fallback (env default, or "no
	 * tunnel yet"). Swallowing it silently would hide the fallback, so it is
	 * logged at warn with the reason.
	 */
	private async readSetting(key: string): Promise<string | null> {
		try {
			const rows = this.localDb.db.select().from(platformSettings).where(eq(platformSettings.key, key)).limit(1).all();
			const row = rows[0];
			if (row === undefined) return null;
			// An empty stored string means "explicitly unset" (e.g. wildcard) —
			// reported as absent so callers never treat "" as a real value.
			return row.value === "" ? null : row.value;
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			this.logger.warn(`Could not read platform_settings key '${key}' (may be mid-migration): ${msg}`);
			return null;
		}
	}

	/** Remove one settings row. */
	private async deleteSetting(key: string): Promise<void> {
		try {
			await this.localDb.db.delete(platformSettings).where(eq(platformSettings.key, key)).run();
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to clear platform setting '${key}': ${msg}`);
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