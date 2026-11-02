import { eq } from "drizzle-orm";
import { Context, Effect } from "effect";

import { githubApps, githubWebhookEvents } from "@deployer/nest-schema/global/fleet/github-provider";
import { appConfig } from "@deployer/nest-schema/global/platform/app-config";
import { services } from "@deployer/nest-schema/global/project/deployment";

import { FleetDb } from "@/core/database/fleet-db";

type GithubAppInsert = typeof githubApps.$inferInsert;

/**
 * The single data-access layer for the GitHub apps and the webhook runtime config. Drizzle only: no
 * constructor DI, every method yields `FleetDb` when it runs.
 */
export class GithubAppsStoreImpl {
	/** List all GitHub apps, oldest first. */
	list() {
		return Effect.gen(function* () {
			const database = yield* FleetDb;
			return yield* database.use(async (db) =>
				db
					.select({
						id: githubApps.id,
						name: githubApps.name,
						appId: githubApps.appId,
						clientId: githubApps.clientId,
						isActive: githubApps.isActive,
						createdAt: githubApps.createdAt,
						updatedAt: githubApps.updatedAt,
					})
					.from(githubApps)
					.orderBy(githubApps.createdAt),
			);
		});
	}

	/** Select the full app row by DB id (for registration + installation access). */
	findById(id: string) {
		return Effect.gen(function* () {
			const database = yield* FleetDb;
			return yield* database.use(async (db) => {
				const rows = await db
					.select({
						id: githubApps.id,
						appId: githubApps.appId,
						privateKey: githubApps.privateKey,
						clientId: githubApps.clientId,
						clientSecret: githubApps.clientSecret,
						webhookSecret: githubApps.webhookSecret,
						installationId: githubApps.installationId,
					})
					.from(githubApps)
					.where(eq(githubApps.id, id))
					.limit(1);
				return rows[0] ?? null;
			});
		});
	}

	/** Select app rows for provider operations (active apps, optionally scoped by id). */
	findProviderApps(providerAppId?: string) {
		return Effect.gen(function* () {
			const database = yield* FleetDb;
			return yield* database.use(async (db) => {
				const qb = db
					.select({
						id: githubApps.id,
						name: githubApps.name,
						appId: githubApps.appId,
						privateKey: githubApps.privateKey,
						clientId: githubApps.clientId,
						clientSecret: githubApps.clientSecret,
						webhookSecret: githubApps.webhookSecret,
						installationId: githubApps.installationId,
					})
					.from(githubApps);
				return providerAppId
					? await qb.where(eq(githubApps.id, providerAppId)).limit(1)
					: await qb.where(eq(githubApps.isActive, true));
			});
		});
	}

	/** Create a GitHub app row. */
	create(input: {
		name: string;
		appId: string;
		clientId: string;
		clientSecret: string;
		privateKey: string;
		webhookSecret: string;
		installationId?: string | null;
		isActive?: boolean;
	}) {
		return Effect.gen(function* () {
			const database = yield* FleetDb;
			return yield* database.use(async (db) => {
				const [row] = await db
					.insert(githubApps)
					.values({
						name: input.name,
						appId: input.appId,
						clientId: input.clientId,
						clientSecret: input.clientSecret,
						privateKey: input.privateKey,
						webhookSecret: input.webhookSecret,
						installationId: input.installationId ?? null,
						isActive: input.isActive ?? true,
					})
					.returning();
				return row ?? null;
			});
		});
	}

	/** Update a GitHub app row by id. Returns the updated row or null. */
	updateById(id: string, values: Partial<GithubAppInsert>) {
		return Effect.gen(function* () {
			const database = yield* FleetDb;
			return yield* database.use(async (db) => {
				const [row] = await db
					.update(githubApps)
					.set({ ...values, updatedAt: new Date() })
					.where(eq(githubApps.id, id))
					.returning();
				return row ?? null;
			});
		});
	}

	/** Delete a GitHub app row by id. */
	deleteById(id: string) {
		return Effect.gen(function* () {
			const database = yield* FleetDb;
			yield* database.use(async (db) => {
				await db.delete(githubApps).where(eq(githubApps.id, id));
			});
		});
	}

	/** Record the installation id for an app matched by name. Returns the updated row or null. */
	setInstallationByName(name: string, installationId: string) {
		return Effect.gen(function* () {
			const database = yield* FleetDb;
			return yield* database.use(async (db) => {
				const [updated] = await db
					.update(githubApps)
					.set({ installationId, updatedAt: new Date() })
					.where(eq(githubApps.name, name))
					.returning({ id: githubApps.id, appId: githubApps.appId });
				return updated ?? null;
			});
		});
	}

	/** Select the clientId for an app by id (OAuth init). */
	findClientIdById(id: string) {
		return Effect.gen(function* () {
			const database = yield* FleetDb;
			return yield* database.use(async (db) => {
				const rows = await db
					.select({ id: githubApps.id, clientId: githubApps.clientId })
					.from(githubApps)
					.where(eq(githubApps.id, id))
					.limit(1);
				return rows[0] ?? null;
			});
		});
	}

	/** Select the client credentials for an app by id (OAuth callback). */
	findClientCredentialsById(id: string) {
		return Effect.gen(function* () {
			const database = yield* FleetDb;
			return yield* database.use(async (db) => {
				const rows = await db
					.select({
						id: githubApps.id,
						clientId: githubApps.clientId,
						clientSecret: githubApps.clientSecret,
					})
					.from(githubApps)
					.where(eq(githubApps.id, id))
					.limit(1);
				return rows[0] ?? null;
			});
		});
	}

	// ─── Webhook runtime config ──────────────────────────────────────────────

	/**
	 * Record (or clear, when `installationId` is null) the GitHub App installation id for a given
	 * app id. Answers true when a row matched.
	 */
	setInstallation(appId: string, installationId: string | null) {
		return Effect.gen(function* () {
			const database = yield* FleetDb;
			return yield* database.use(async (db): Promise<boolean> => {
				const [updated] = await db
					.update(githubApps)
					.set({ installationId, updatedAt: new Date() })
					.where(eq(githubApps.appId, appId))
					.returning({ id: githubApps.id });
				return Boolean(updated);
			});
		});
	}

	/**
	 * Load the runtime webhook secret for the `github_webhook` config key. Answers null when it is
	 * not configured, or when the database is not available yet: the webhook guard fails closed on it.
	 */
	getWebhookSecret() {
		return Effect.gen(function* () {
			const database = yield* FleetDb;
			return yield* database.use(async (db): Promise<string | null> => {
				const rows = await db.select().from(appConfig).where(eq(appConfig.key, "github_webhook")).limit(1);
				const config = rows[0];
				if (config?.value) {
					const parsed = JSON.parse(config.value) as { webhookSecret?: string };
					if (parsed.webhookSecret) return parsed.webhookSecret;
				}
				return null;
			});
		}).pipe(Effect.orElseSucceed((): string | null => null));
	}

	/**
	 * Find the platform service mapped to a repository source URL, the webhook-to-service bridge.
	 * Matches `providerConfig.sourceUrl` normalized (trimmed, lowercased, trailing slashes stripped).
	 * When `projectId` is given the scan is project-scoped.
	 */
	findServiceBySourceUrl(sourceUrl: string, projectId?: string) {
		return Effect.gen(function* () {
			const database = yield* FleetDb;
			return yield* database.use(async (db) => {
				const normalized = sourceUrl.trim().toLowerCase().replace(/\/+$/, "");
				const rows = projectId
					? await db.select().from(services).where(eq(services.projectId, projectId))
					: await db.select().from(services);
				const match = rows.find((row) => {
					const source = (row.providerConfig as { sourceUrl?: string } | null)?.sourceUrl;
					return (
						source !== undefined &&
						typeof source === "string" &&
						source.trim().toLowerCase().replace(/\/+$/, "") === normalized
					);
				});
				return match ?? null;
			});
		});
	}

	/**
	 * Atomically claim a webhook delivery by `delivery_id` (durable idempotency). The unique index on
	 * `delivery_id` makes the first INSERT the claim; a redelivery conflicts (ON CONFLICT DO NOTHING)
	 * and answers false. Survives process restarts.
	 */
	claimWebhookDelivery(input: { event: string; deliveryId: string; payload: unknown }) {
		return Effect.gen(function* () {
			const database = yield* FleetDb;
			return yield* database.use(async (db): Promise<boolean> => {
				const [row] = await db
					.insert(githubWebhookEvents)
					.values({
						githubAppId: null,
						event: input.event,
						deliveryId: input.deliveryId,
						payload: input.payload,
						processed: false,
					})
					.onConflictDoNothing({ target: githubWebhookEvents.deliveryId })
					.returning({ id: githubWebhookEvents.id });
				return row !== undefined;
			});
		});
	}
}

/** The store's public surface is exactly the implementation's methods. */
export type GithubAppsStoreShape = GithubAppsStoreImpl;

/** Effect key = NestJS token. */
export class GithubAppsStore extends Context.Service<GithubAppsStore, GithubAppsStoreShape>()(
	"fleet/GithubAppsStore",
) {
	/** Resolves the requirements the methods name when a call runs. */
	static readonly live: GithubAppsStoreShape = new GithubAppsStoreImpl();
}
