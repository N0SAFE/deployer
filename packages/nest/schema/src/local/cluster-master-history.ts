import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Append-only audit trail of master elections (docs/swarm-orchestration/02 §6,
 * SW-046). Each row records who became master, at which term, why, and how
 * long the previous master held leadership (computed on takeover).
 */
export const clusterMasterHistory = sqliteTable("cluster_master_history", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    nodeId: text("node_id").notNull(),
    term: integer("term").notNull(),
    electedAt: text("elected_at").notNull(),
    reason: text("reason"),
    /** How long the PREVIOUS master held leadership (ms), null on first. */
    durationMs: integer("duration_ms"),
});

export type ClusterMasterHistoryRow = typeof clusterMasterHistory.$inferSelect;
export type ClusterMasterHistoryInsert = typeof clusterMasterHistory.$inferInsert;