import { ConflictError } from "@deployer/errors";
import { webhooks } from "@deployer/nest-schema/global/project/deployment";
import { eq, and } from "drizzle-orm";
import { Context, Effect } from "effect";
import { DatabasePort } from "@project/core/database/database.port";
import { attempt } from "@project/core/effect/attempt";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

type WebhookRow = typeof webhooks.$inferSelect;

export type WebhookCreateInput = Pick<
	WebhookRow,
	"projectId" | "sourceType" | "webhookUrl" | "secret"
> & {
	serviceId?: string | null;
	externalWebhookId?: string | null;
	settings?: WebhookRow["settings"];
};

export type WebhookUpdateInput = Partial<
	Pick<WebhookRow, "webhookUrl" | "externalWebhookId" | "settings" | "isActive">
>;

/** Drizzle implementation of the webhooks table. No constructor DI: every method yields `DatabasePort`. */
export class WebhookStoreImpl {
	findById(id: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const results = await db
					.select()
					.from(webhooks)
					.where(eq(webhooks.id, id))
					.limit(1);
				return (results[0] ?? null);
			});
		});
	}

	findByProject(projectId: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				return (await db
					.select()
					.from(webhooks)
					.where(eq(webhooks.projectId, projectId)));
			});
		});
	}

	create(input: WebhookCreateInput) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			const row = yield* attempt(async () => {
				const results = await db
					.insert(webhooks)
					.values(input)
					.returning();
				return results[0];
			});
			if (!row) return yield* Effect.fail(new ConflictError("Failed to create webhook"));
			return row;
		});
	}

	update(id: string, input: WebhookUpdateInput) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const results = await db
					.update(webhooks)
					.set({ ...input, updatedAt: new Date() })
					.where(eq(webhooks.id, id))
					.returning();
				return (results[0] ?? null);
			});
		});
	}

	updateSecret(id: string, secret: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const results = await db
					.update(webhooks)
					.set({ secret, updatedAt: new Date() })
					.where(eq(webhooks.id, id))
					.returning();
				return (results[0] ?? null);
			});
		});
	}

	incrementTriggerCount(id: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			yield* attempt(async () => {
				await db
					.update(webhooks)
					.set({ lastTriggered: new Date(), updatedAt: new Date() })
					.where(and(eq(webhooks.id, id), eq(webhooks.isActive, true)));
			});
		});
	}

	delete(id: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			yield* attempt(async () => {
				await db.delete(webhooks).where(eq(webhooks.id, id));
			});
		});
	}
}

/** The store's public surface is exactly the implementation's methods. */
export type WebhookStoreShape = WebhookStoreImpl;

/** Effect key = NestJS token. */
export class WebhookStore extends Context.Service<WebhookStore, WebhookStoreShape>()(
	"project/WebhookStore",
) {}
