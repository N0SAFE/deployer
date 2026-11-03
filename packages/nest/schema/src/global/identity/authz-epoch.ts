import { bigint, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The version of the authorization catalogue (`SEC-055`).
 *
 * One row. Every write that changes what a role GRANTS bumps it; a reader compares the value it loaded against this one
 * and reloads when they differ. It exists so a permission cache cannot outlive the edit that invalidated it — the reason
 * a cache is safe to have at all.
 *
 * `bigint` as a string: JavaScript numbers lose precision above 2^53, and a monotonic counter that silently wraps is
 * worse than no counter.
 */
export const authzEpoch = pgTable("authz_epoch", {
	id: text("id").primaryKey(),
	value: bigint("value", { mode: "number" }).notNull().default(1),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
