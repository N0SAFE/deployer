// packages/nest/schema/src/global/cluster-migration-state.ts
import { pgTable, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
var clusterMigrationState2 = pgTable("cluster_migration_state", {
  id: integer("id").primaryKey().default(1),
  clusterSchemaVersion: text("cluster_schema_version").notNull(),
  requiredAppVersion: text("required_app_version").notNull(),
  consensusNodeIds: jsonb("consensus_node_ids").notNull().$type(),
  recordVersion: integer("record_version").notNull().default(1),
  lastConsensusAt: timestamp("last_consensus_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date)
});

export { clusterMigrationState2 };
