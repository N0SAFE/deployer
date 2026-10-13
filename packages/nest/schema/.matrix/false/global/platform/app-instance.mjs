// packages/nest/schema/src/global/platform/app-instance.ts
import { relations } from "drizzle-orm";
import { pgTable, text, uuid, timestamp, index } from "drizzle-orm/pg-core";
import z from "zod/v4";
var appInstances = pgTable("app_instances", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull(),
  kind: text("kind", { enum: ["managed", "external"] }).notNull().default("external"),
  tokenHash: text("token_hash").notNull().unique(),
  status: text("status", { enum: ["active", "stale", "revoked"] }).notNull().default("active"),
  createdByUserId: text("created_by_user_id"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [index("app_instances_status_idx").on(table.status)]);
var appInstancesRelations = relations(appInstances, () => ({}));
var appInstanceKindSchema = z.enum(["managed", "external"]);
var appInstanceStatusSchema = z.enum(["active", "stale", "revoked"]);
var appInstanceEntitySchema = z.object({
  id: z.uuid(),
  label: z.string().min(1),
  kind: appInstanceKindSchema,
  status: appInstanceStatusSchema,
  createdByUserId: z.string().nullable(),
  lastSeenAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date()
});
export {
  appInstanceEntitySchema,
  appInstanceKindSchema,
  appInstanceStatusSchema,
  appInstances,
  appInstancesRelations
};
