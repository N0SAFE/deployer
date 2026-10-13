// packages/nest/schema/src/global/schema-version.ts
import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
var schemaVersion2 = pgTable("schema_version", {
  nodeId: text("node_id").primaryKey(),
  schemaVersion: text("schema_version").notNull(),
  appliedMigrations: jsonb("applied_migrations").notNull().$type(),
  appVersion: text("app_version").notNull(),
  lastVerification: timestamp("last_verification", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date)
});

export { schemaVersion2 };
