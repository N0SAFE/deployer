import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Tracks the schema version of each mesh node within the cluster.
 *
 * - One row per node (node_id), upserted on every startup and periodically.
 * - When all nodes report the same `schemaVersion`, the cluster is consistent.
 * - A node may be on a LOWER version if it hasn't started recently (stale).
 * - A node should NEVER be on a HIGHER version than the cluster consensus —
 *   that would mean it applied migrations that others don't know about.
 *
 * Created by migration 0011_mesh_coordination_tables.
 */
export const schemaVersion = pgTable("schema_version", {
  /// Node identity (UUID matching cluster_nodes.nodeId)
  nodeId: text("node_id").primaryKey(),

  /// Latest migration version applied by this node
  /// e.g. "0011" from the last entry in __drizzle_migrations
  schemaVersion: text("schema_version").notNull(),

  /// Full ordered list of applied migration file names
  /// e.g. ["0000_brave_steve_rogers", ..., "0011_mesh_coordination_tables"]
  appliedMigrations: jsonb("applied_migrations").notNull().$type<string[]>(),

  /// Application version from package.json
  /// e.g. "2.1.0"
  appVersion: text("app_version").notNull(),

  /// When this node last verified / reported its schema state
  lastVerification: timestamp("last_verification", { withTimezone: true })
    .notNull()
    .defaultNow(),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
