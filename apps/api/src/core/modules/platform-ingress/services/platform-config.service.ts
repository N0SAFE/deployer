/**
 * PlatformConfigService — typed access to platform-level settings in the
 * existing app_config KV store. The managed-web flag lives here (DB wins over
 * env after first read; MANAGED_WEB_APP_ENABLED only seeds the initial value).
 */

import { Injectable } from "@nestjs/common";
import { eq, or } from "drizzle-orm";
import z from "zod/v4";

import { GlobalDatabaseService } from "@/core/modules/database/services/global-database.service";
import { EnvService } from "@/config/env/env.service";
import { appConfig } from "@/config/drizzle/global/schema";

export const MANAGED_WEB_APP_ENABLED_KEY = "managed_web_app.enabled";

/** Custom public origin of the managed web app (its OWN surface, distinct
 *  from the node's global API address). When unset the platform web hostname
 *  is used. */
export const MANAGED_WEB_ORIGIN_KEY = "managed_web_app.origin";

/** Dedicated Cloudflare tunnel for the web app (own hostname + ingress to the
 *  managed web container — NOT the node's global tunnel which serves the API
 *  only). */
export const MANAGED_WEB_TUNNEL_ID_KEY = "managed_web_app.tunnel_id";
export const MANAGED_WEB_TUNNEL_HOSTNAME_KEY = "managed_web_app.tunnel_hostname";
export const MANAGED_WEB_TUNNEL_PROVIDER_KEY = "managed_web_app.tunnel_provider_id";

/** Parse a stored "true"/"false" string into a boolean (invalid → parse failure). */
const booleanValueSchema = z
	.string()
	.trim()
	.toLowerCase()
	.transform((raw, ctx) => {
		if (raw === "true") return true;
		if (raw === "false") return false;
		ctx.addIssue({ code: "custom", message: "expected \"true\" or \"false\"" });
		return z.NEVER;
	});

@Injectable()
export class PlatformConfigService {
	constructor(
		private readonly db: GlobalDatabaseService,
		private readonly env: EnvService,
	) {}

	/** Read the managed-web flag; seeds from env on first access. */
	async isManagedWebAppEnabled(): Promise<boolean> {
		// Guard against missing app_config table during early boot or
		// first-time migration — fall back to the env seed value.
		const rows = await this.db.db
			.select()
			.from(appConfig)
			.where(eq(appConfig.key, MANAGED_WEB_APP_ENABLED_KEY))
			.limit(1)
			.catch((): [] => []);

		const row = rows[0];
		if (row !== undefined) {
			const parsed = booleanValueSchema.safeParse(row.value);
			return parsed.success ? parsed.data : false;
		}

		const seeded = this.env.get("MANAGED_WEB_APP_ENABLED");
		await this.setManagedWebAppEnabled(seeded);
		return seeded;
	}

	async setManagedWebAppEnabled(enabled: boolean): Promise<void> {
		await this.db.db
			.insert(appConfig)
			.values({
				key: MANAGED_WEB_APP_ENABLED_KEY,
				value: enabled ? "true" : "false",
				description: "API-centric deployment: spawn/supervise the managed web app",
			})
			.onConflictDoUpdate({
				target: appConfig.key,
				set: { value: enabled ? "true" : "false", updatedAt: new Date() },
			});
	}

	/** Normalize a public origin: strip scheme, lowercase, no trailing slash. */
	private static normalizeHost(origin: string): string {
		return origin
			.trim()
			.replace(/^[a-z]+:\/\//i, "")
			.replace(/\/+$/, "")
			.toLowerCase();
	}

	/** Custom public origin of the managed web app (its OWN surface — the web
	 *  app does NOT share the node's global address). A domain or a public IP;
	 *  when unset the platform web hostname (`web.<base>`) is used. */
	async getManagedWebOrigin(): Promise<string | null> {
		const rows = await this.db.db
			.select()
			.from(appConfig)
			.where(eq(appConfig.key, MANAGED_WEB_ORIGIN_KEY))
			.limit(1)
			.catch((): [] => []);

		const raw = rows[0]?.value;
		if (raw === undefined || raw === "") return null;
		return PlatformConfigService.normalizeHost(raw);
	}

	/** Persist (or clear with null) the managed web app's custom public origin.
	 *  The reconciler publishes it to Traefik (Host → web) and injects it into
	 *  the web container's allowed dev origins. */
	async setManagedWebOrigin(origin: string | null): Promise<void> {
		if (origin === null || origin.trim() === "") {
			await this.db.db
				.delete(appConfig)
				.where(eq(appConfig.key, MANAGED_WEB_ORIGIN_KEY));
			return;
		}
		await this.db.db
			.insert(appConfig)
			.values({
				key: MANAGED_WEB_ORIGIN_KEY,
				value: PlatformConfigService.normalizeHost(origin),
				description: "Custom public origin (domain/IP) of the managed web app — routed to the web container via Traefik",
			})
			.onConflictDoUpdate({
				target: appConfig.key,
				set: { value: PlatformConfigService.normalizeHost(origin), updatedAt: new Date() },
			});
	}

	/** Dedicated Cloudflare tunnel for the web app (own hostname + ingress to
	 *  Traefik → web container). Distinct from the node's global tunnel. */
	async getManagedWebTunnel(): Promise<
		{ tunnelId: string; hostname: string; providerId: string } | null
	> {
		const [idRow, hostRow, providerRow] = await Promise.all([
			this.#read(MANAGED_WEB_TUNNEL_ID_KEY),
			this.#read(MANAGED_WEB_TUNNEL_HOSTNAME_KEY),
			this.#read(MANAGED_WEB_TUNNEL_PROVIDER_KEY),
		]);
		if (idRow === null || hostRow === null || providerRow === null) return null;
		return { tunnelId: idRow, hostname: hostRow, providerId: providerRow };
	}

	/** Persist the managed web tunnel identity (id + hostname + provider). */
	async setManagedWebTunnel(tunnel: {
		tunnelId: string;
		hostname: string;
		providerId: string;
	}): Promise<void> {
		const values = [
			{ key: MANAGED_WEB_TUNNEL_ID_KEY, value: tunnel.tunnelId },
			{ key: MANAGED_WEB_TUNNEL_HOSTNAME_KEY, value: PlatformConfigService.normalizeHost(tunnel.hostname) },
			{ key: MANAGED_WEB_TUNNEL_PROVIDER_KEY, value: tunnel.providerId },
		];
		for (const v of values) {
			await this.db.db
				.insert(appConfig)
				.values({ key: v.key, value: v.value, description: null })
				.onConflictDoUpdate({
					target: appConfig.key,
					set: { value: v.value, updatedAt: new Date() },
				});
		}
	}

	/** Remove the managed web tunnel identity (after the tunnel was deleted). */
	async clearManagedWebTunnel(): Promise<void> {
		await this.db.db
			.delete(appConfig)
			.where(
				or(
					eq(appConfig.key, MANAGED_WEB_TUNNEL_ID_KEY),
					eq(appConfig.key, MANAGED_WEB_TUNNEL_HOSTNAME_KEY),
					eq(appConfig.key, MANAGED_WEB_TUNNEL_PROVIDER_KEY),
				),
			);
	}

	/** Read a single app_config value (null when absent). */
	async #read(key: string): Promise<string | null> {
		const rows = await this.db.db
			.select()
			.from(appConfig)
			.where(eq(appConfig.key, key))
			.limit(1)
			.catch((): [] => []);
		const raw = rows[0]?.value;
		return raw === undefined || raw === "" ? null : raw;
	}
}
