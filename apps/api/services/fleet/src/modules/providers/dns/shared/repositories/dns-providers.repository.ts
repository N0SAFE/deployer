import { eq } from "drizzle-orm";
import { Context, Effect } from "effect";

import { dnsProviders } from "@deployer/nest-schema/global/fleet/dns-providers";

import { FleetDb } from "@/core/database/fleet-db";

type DnsProviderRow = typeof dnsProviders.$inferSelect;
type DnsProviderInsert = typeof dnsProviders.$inferInsert;

/**
 * The single data-access layer for `dns_providers` rows. Drizzle only: no constructor DI, every
 * method yields `FleetDb` when it runs.
 */
export class DnsProvidersStoreImpl {
	/** Load a provider row by id. */
	findById(providerId: string) {
		return Effect.gen(function* () {
			const database = yield* FleetDb;
			return yield* database.use(async (db): Promise<DnsProviderRow | null> => {
				const rows = await db.select().from(dnsProviders).where(eq(dnsProviders.id, providerId)).limit(1);
				return rows[0] ?? null;
			});
		});
	}

	/** List provider rows, optionally filtered by provider type. */
	list(providerType?: string) {
		return Effect.gen(function* () {
			const database = yield* FleetDb;
			return yield* database.use(async (db): Promise<DnsProviderRow[]> => {
				const query = db.select().from(dnsProviders);
				return providerType ? await query.where(eq(dnsProviders.providerType, providerType)) : await query;
			});
		});
	}

	/** Create a provider row. */
	create(values: DnsProviderInsert) {
		return Effect.gen(function* () {
			const database = yield* FleetDb;
			return yield* database.use(async (db): Promise<DnsProviderRow | null> => {
				const rows = await db.insert(dnsProviders).values(values).returning();
				return rows[0] ?? null;
			});
		});
	}

	/** Update a provider row by id. Returns the updated row or null. */
	updateById(providerId: string, values: Partial<DnsProviderInsert>) {
		return Effect.gen(function* () {
			const database = yield* FleetDb;
			return yield* database.use(async (db): Promise<DnsProviderRow | null> => {
				const rows = await db.update(dnsProviders).set(values).where(eq(dnsProviders.id, providerId)).returning();
				return rows[0] ?? null;
			});
		});
	}

	/** Delete a provider row by id. */
	deleteById(providerId: string) {
		return Effect.gen(function* () {
			const database = yield* FleetDb;
			yield* database.use(async (db) => {
				await db.delete(dnsProviders).where(eq(dnsProviders.id, providerId));
			});
		});
	}
}

/** The store's public surface is exactly the implementation's methods. */
export type DnsProvidersStoreShape = DnsProvidersStoreImpl;

/** Effect key = NestJS token. */
export class DnsProvidersStore extends Context.Service<DnsProvidersStore, DnsProvidersStoreShape>()(
	"fleet/DnsProvidersStore",
) {
	/** Resolves the requirements the methods name when a call runs. */
	static readonly live: DnsProvidersStoreShape = new DnsProvidersStoreImpl();
}
