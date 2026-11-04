/**
 * PlatformConfigService — typed access to platform-level settings in the
 * existing app_config KV store. The managed-web flag lives here (DB wins over
 * env after first read; MANAGED_WEB_APP_ENABLED only seeds the initial value).
 */

import { eq, or } from "drizzle-orm";
import { Context, Effect } from "effect";
import z from "zod/v4";

import { appConfig } from "@deployer/nest-schema/global";

import { storage, type DatabasePort, type StorageFailure } from "../../database/storage";

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

/** Normalize a public origin: strip scheme, lowercase, no trailing slash. */
const normalizeHost = (origin: string): string =>
	origin
		.trim()
		.replace(/^[a-z]+:\/\//i, "")
		.replace(/\/+$/, "")
		.toLowerCase();

export type ManagedWebTunnel = { tunnelId: string; hostname: string; providerId: string };

export type PlatformConfigServiceShape = {
	/**
	 * Read the managed-web flag; seeds from env on first access. Never fails: while the `app_config` table is missing (early
	 * boot, first migration) the env seed value answers.
	 */
	readonly isManagedWebAppEnabled: () => Effect.Effect<boolean>;
	readonly setManagedWebAppEnabled: (enabled: boolean) => Effect.Effect<void, StorageFailure>;
	/** Custom public origin of the managed web app (its OWN surface, not the node's global address); a domain or public IP. */
	readonly getManagedWebOrigin: () => Effect.Effect<string | null>;
	/** Persist (or clear with null) the custom origin. The reconciler publishes it to Traefik and the web container. */
	readonly setManagedWebOrigin: (origin: string | null) => Effect.Effect<void, StorageFailure>;
	/** The web app's dedicated Cloudflare tunnel (own hostname, distinct from the node's global tunnel). */
	readonly getManagedWebTunnel: () => Effect.Effect<ManagedWebTunnel | null>;
	readonly setManagedWebTunnel: (tunnel: ManagedWebTunnel) => Effect.Effect<void, StorageFailure>;
	/** Remove the tunnel identity (after the tunnel was deleted). */
	readonly clearManagedWebTunnel: () => Effect.Effect<void, StorageFailure>;
};

type Ports = {
	readonly database: Context.Service.Shape<typeof DatabasePort>;
	/** The `MANAGED_WEB_APP_ENABLED` environment value, the seed of the stored flag. */
	readonly managedWebSeed: () => boolean;
};

export function makePlatformConfigService({ database, managedWebSeed }: Ports): PlatformConfigServiceShape {
	const upsert = (key: string, value: string, description: string | null) =>
		storage(database, (db) =>
			db.insert(appConfig).values({ key, value, description }).onConflictDoUpdate({ target: appConfig.key, set: { value, updatedAt: new Date() } }),
		).pipe(Effect.asVoid);

	/** One app_config value; null when absent or when the table cannot be read. */
	const read = (key: string): Effect.Effect<string | null> =>
		storage(database, (db) => db.select().from(appConfig).where(eq(appConfig.key, key)).limit(1)).pipe(
			Effect.map((rows) => {
				const raw = rows[0]?.value;
				return raw === undefined || raw === "" ? null : raw;
			}),
			Effect.catch(() => Effect.succeed(null)),
		);

	const setManagedWebAppEnabled: PlatformConfigServiceShape["setManagedWebAppEnabled"] = (enabled) =>
		upsert(MANAGED_WEB_APP_ENABLED_KEY, enabled ? "true" : "false", "API-centric deployment: spawn/supervise the managed web app");

	return {
		isManagedWebAppEnabled: () =>
			Effect.gen(function* () {
				// A missing table reads as "no row": the env seed answers.
				const rows = yield* storage(database, (db) =>
					db.select().from(appConfig).where(eq(appConfig.key, MANAGED_WEB_APP_ENABLED_KEY)).limit(1),
				).pipe(Effect.catch(() => Effect.succeed([] as { value: string }[])));
				const row = rows[0];
				if (row !== undefined) {
					const parsed = booleanValueSchema.safeParse(row.value);
					return parsed.success ? parsed.data : false;
				}
				const seeded = managedWebSeed();
				yield* setManagedWebAppEnabled(seeded).pipe(Effect.catch(() => Effect.void));
				return seeded;
			}),
		setManagedWebAppEnabled,

		getManagedWebOrigin: () => read(MANAGED_WEB_ORIGIN_KEY).pipe(Effect.map((raw) => (raw === null ? null : normalizeHost(raw)))),

		setManagedWebOrigin: (origin) =>
			origin === null || origin.trim() === ""
				? storage(database, (db) => db.delete(appConfig).where(eq(appConfig.key, MANAGED_WEB_ORIGIN_KEY))).pipe(Effect.asVoid)
				: upsert(
						MANAGED_WEB_ORIGIN_KEY,
						normalizeHost(origin),
						"Custom public origin (domain/IP) of the managed web app — routed to the web container via Traefik",
					),

		getManagedWebTunnel: () =>
			Effect.all([read(MANAGED_WEB_TUNNEL_ID_KEY), read(MANAGED_WEB_TUNNEL_HOSTNAME_KEY), read(MANAGED_WEB_TUNNEL_PROVIDER_KEY)]).pipe(
				Effect.map(([tunnelId, hostname, providerId]) =>
					tunnelId === null || hostname === null || providerId === null ? null : { tunnelId, hostname, providerId },
				),
			),

		setManagedWebTunnel: (tunnel) =>
			Effect.all([
				upsert(MANAGED_WEB_TUNNEL_ID_KEY, tunnel.tunnelId, null),
				upsert(MANAGED_WEB_TUNNEL_HOSTNAME_KEY, normalizeHost(tunnel.hostname), null),
				upsert(MANAGED_WEB_TUNNEL_PROVIDER_KEY, tunnel.providerId, null),
			]).pipe(Effect.asVoid),

		clearManagedWebTunnel: () =>
			storage(database, (db) =>
				db
					.delete(appConfig)
					.where(
						or(
							eq(appConfig.key, MANAGED_WEB_TUNNEL_ID_KEY),
							eq(appConfig.key, MANAGED_WEB_TUNNEL_HOSTNAME_KEY),
							eq(appConfig.key, MANAGED_WEB_TUNNEL_PROVIDER_KEY),
						),
					),
			).pipe(Effect.asVoid),
	};
}

export class PlatformConfigService extends Context.Service<PlatformConfigService, PlatformConfigServiceShape>()(
	"shared/PlatformConfigService",
) {}
