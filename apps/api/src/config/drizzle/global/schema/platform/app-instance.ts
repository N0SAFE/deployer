import { relations } from "drizzle-orm";
import { pgTable, text, uuid, timestamp, index } from "drizzle-orm/pg-core";
import z from "zod/v4";

/**
 * App instances — registered deployer web app installations (api-centric
 * deployment architecture). Each instance proves its identity with an opaque
 * token; only the SHA-256 hash is persisted. The token is issued TO THE WEB
 * APP ITSELF — it never carries user claims.
 */
export const appInstances = pgTable(
	"app_instances",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		label: text("label").notNull(),
		/** "managed" = spawned by this API, "external" = consumer-hosted. */
		kind: text("kind", { enum: ["managed", "external"] }).notNull().default("external"),
		tokenHash: text("token_hash").notNull().unique(),
		status: text("status", { enum: ["active", "stale", "revoked"] }).notNull().default("active"),
		createdByUserId: text("created_by_user_id"),
		lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [index("app_instances_status_idx").on(table.status)],
);

export const appInstancesRelations = relations(appInstances, () => ({}));

// ─── Zod schemas (SSOT for the entity shape) ────────────────────────────────

export const appInstanceKindSchema = z.enum(["managed", "external"]);
export const appInstanceStatusSchema = z.enum(["active", "stale", "revoked"]);

export const appInstanceEntitySchema = z.object({
	id: z.uuid(),
	label: z.string().min(1),
	kind: appInstanceKindSchema,
	status: appInstanceStatusSchema,
	createdByUserId: z.string().nullable(),
	lastSeenAt: z.date(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

export type AppInstanceEntity = z.infer<typeof appInstanceEntitySchema>;
