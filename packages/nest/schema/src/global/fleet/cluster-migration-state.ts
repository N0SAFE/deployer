import { pgTable, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";

/**
 * Cluster-wide migration state — a singleton row (always id = 1) that tracks
 * the global schema version and the minimum app version required to participate.
 *
 * - `clusterSchemaVersion` advances only when the cluster reaches consensus.
 * - `requiredAppVersion` is the highest minAppVersion across all applied migrations.
 * - `consensusNodeIds` lists the nodes that participated in the last consensus.
 * - `recordVersion` enables optimistic locking for concurrent writes.
 *
 * Created by migration 0011_mesh_coordination_tables.
 */
export const clusterMigrationState = pgTable("cluster_migration_state", {
  /// Singleton — always has exactly one row with id = 1
  id: integer("id").primaryKey().default(1),

  /// The highest migration version that ALL active consensus nodes have applied.
  /// Advances only when the cluster reaches agreement.
  clusterSchemaVersion: text("cluster_schema_version").notNull(),

  /// The minimum app version (semver range) required to be in the cluster.
  /// Nodes with appVersion below this are considered outdated and may be blocked.
  /// Derived from package.json version at registration time.
  requiredAppVersion: text("required_app_version").notNull(),

  /// List of active node IDs that contributed to the current consensus.
  /// Updated each time consensus is re-evaluated.
  consensusNodeIds: jsonb("consensus_node_ids").notNull().$type<string[]>(),

  /// Optimistic locking — incremented on every update.
  /// Used to detect concurrent writes and prevent lost updates.
  recordVersion: integer("record_version").notNull().default(1),

  /// Last time consensus was verified / updated
  lastConsensusAt: timestamp("last_consensus_at", { withTimezone: true })
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
