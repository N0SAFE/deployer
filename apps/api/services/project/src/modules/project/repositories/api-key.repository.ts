import { ConflictError } from "@deployer/errors";
import { apiKeys } from "@deployer/nest-schema/global/project/deployment";
import { eq, and } from "drizzle-orm";
import { Context, Effect } from "effect";
import { DatabasePort } from "@project/core/database/database.port";
import { attempt } from "@project/core/effect/attempt";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type ApiKeyCreateInput = {
	userId: string;
	name: string;
	keyHash: string;
	keyPreview: string;
	projectId?: string | null;
	scopes?: string[] | null;
	expiresAt?: Date | null;
};

/** Drizzle implementation of the API-key table. No constructor DI: every method yields `DatabasePort`. */
export class ApiKeyStoreImpl {
	findById(id: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const results = await db
					.select()
					.from(apiKeys)
					.where(eq(apiKeys.id, id))
					.limit(1);
				return (results[0] ?? null);
			});
		});
	}

	findByHash(keyHash: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const results = await db
					.select()
					.from(apiKeys)
					.where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.isActive, true)))
					.limit(1);
				return (results[0] ?? null);
			});
		});
	}

	findByUser(userId: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				return (await db.select().from(apiKeys).where(eq(apiKeys.userId, userId)));
			});
		});
	}

	findByProject(projectId: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				return (await db.select().from(apiKeys).where(eq(apiKeys.projectId, projectId)));
			});
		});
	}

	create(input: ApiKeyCreateInput) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			const row = yield* attempt(async () => {
				const results = await db.insert(apiKeys).values(input).returning();
				return results[0];
			});
			if (!row) return yield* Effect.fail(new ConflictError("Failed to create API key"));
			return row;
		});
	}

	setActive(id: string, isActive: boolean) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const results = await db
					.update(apiKeys)
					.set({ isActive, updatedAt: new Date() })
					.where(eq(apiKeys.id, id))
					.returning();
				return (results[0] ?? null);
			});
		});
	}

	touchLastUsed(id: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			yield* attempt(async () => {
				await db
					.update(apiKeys)
					.set({ lastUsed: new Date() })
					.where(eq(apiKeys.id, id));
			});
		});
	}

	delete(id: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			yield* attempt(async () => {
				await db.delete(apiKeys).where(eq(apiKeys.id, id));
			});
		});
	}
}

/** The store's public surface is exactly the implementation's methods. */
export type ApiKeyStoreShape = ApiKeyStoreImpl;

/** Effect key = NestJS token. */
export class ApiKeyStore extends Context.Service<ApiKeyStore, ApiKeyStoreShape>()(
	"project/ApiKeyStore",
) {}
