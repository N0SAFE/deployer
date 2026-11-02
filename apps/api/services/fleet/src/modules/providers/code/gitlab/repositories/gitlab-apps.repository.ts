import { eq } from "drizzle-orm";
import { Context, Effect } from "effect";

import { gitlabApps } from "@deployer/nest-schema/global/fleet/gitlab-provider";

import { FleetDb } from "@/core/database/fleet-db";

/**
 * The single data-access layer for GitLab account configurations. Drizzle only: no constructor DI,
 * every method yields `FleetDb` when it runs.
 */
export class GitlabAppsStoreImpl {
	/** List all GitLab accounts, oldest first. */
	list() {
		return Effect.gen(function* () {
			const database = yield* FleetDb;
			return yield* database.use(async (db) =>
				db
					.select({
						id: gitlabApps.id,
						name: gitlabApps.name,
						url: gitlabApps.url,
						isActive: gitlabApps.isActive,
						createdAt: gitlabApps.createdAt,
						updatedAt: gitlabApps.updatedAt,
					})
					.from(gitlabApps)
					.orderBy(gitlabApps.createdAt),
			);
		});
	}

	/** Look up an account by name, to refuse a duplicate. */
	findByName(name: string) {
		return Effect.gen(function* () {
			const database = yield* FleetDb;
			return yield* database.use(async (db) => {
				const rows = await db.select({ id: gitlabApps.id }).from(gitlabApps).where(eq(gitlabApps.name, name)).limit(1);
				return rows[0] ?? null;
			});
		});
	}

	/** Create a GitLab account row. */
	create(input: { name: string; url: string; accessToken: string }) {
		return Effect.gen(function* () {
			const database = yield* FleetDb;
			return yield* database.use(async (db) => {
				const [row] = await db
					.insert(gitlabApps)
					.values({ name: input.name, url: input.url, accessToken: input.accessToken, isActive: true })
					.returning();
				return row ?? null;
			});
		});
	}

	/** Delete a GitLab account row by id. Returns the removed id or null. */
	deleteById(id: string) {
		return Effect.gen(function* () {
			const database = yield* FleetDb;
			return yield* database.use(async (db) => {
				const removed = await db.delete(gitlabApps).where(eq(gitlabApps.id, id)).returning({ id: gitlabApps.id });
				return removed[0] ?? null;
			});
		});
	}
}

/** The store's public surface is exactly the implementation's methods. */
export type GitlabAppsStoreShape = GitlabAppsStoreImpl;

/** Effect key = NestJS token. */
export class GitlabAppsStore extends Context.Service<GitlabAppsStore, GitlabAppsStoreShape>()(
	"fleet/GitlabAppsStore",
) {
	/** Resolves the requirements the methods name when a call runs. */
	static readonly live: GitlabAppsStoreShape = new GitlabAppsStoreImpl();
}
