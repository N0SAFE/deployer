import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Local (single-row) snapshot of this node's Swarm cluster membership,
 * persisted by `ClusterNodeRepository` after the Swarm bootstrap converges
 * (docs/swarm-orchestration/02 — SW-012).
 *
 * Mirrors `ClusterSnapshot` from `@repo/contracts-entities` (entities/swarm)
 * plus the join tokens so onboarding tokens survive restarts WITHOUT being
 * stored in `.env` (docs/swarm-orchestration/01 §3 — SW-011).
 *
 * The fleet-wide node inventory (all peers, from `docker node ls`) lives in
 * the shared Postgres later (P3 — NodeInventoryService); this local table is
 * the per-node source of truth for bootstrap-time cluster state.
 */
export const clusterNode = sqliteTable("cluster_node", {
    id: integer("id")
        .primaryKey({ autoIncrement: false })
        .notNull()
        .$default(() => 1),

    /** Swarm cluster ID (engine truth). Null when not part of a cluster. */
    clusterId: text("cluster_id"),

    /** Engine `LocalNodeState` at last persist: inactive|pending|active|error|locked */
    localNodeState: text("local_node_state", {
        enum: ["inactive", "pending", "active", "error", "locked"],
    }),

    /** Swarm role: manager|worker|none */
    swarmRole: text("swarm_role", { enum: ["manager", "worker", "none"] }),

    /** Platform role: both|control|worker (default "both" — shared nodes, doc-04) */
    platformRole: text("platform_role", { enum: ["both", "control", "worker"] }).notNull().default("both"),

    /** Whether this node is the de-facto master (Raft leader until mesh election P4) */
    isMaster: integer("is_master", { mode: "boolean" }).notNull().default(false),

    /** Whether this node carries the ingress label (Traefik target) */
    isIngress: integer("is_ingress", { mode: "boolean" }).notNull().default(false),

    /** Node availability: active|pause|drain */
    availability: text("availability", { enum: ["active", "pause", "drain"] }).notNull().default("active"),

    /** Total nodes in the cluster at last persist */
    nodeCount: integer("node_count").notNull().default(0),

    /** Swarm manager count at last persist */
    managerCount: integer("manager_count").notNull().default(0),

    /** Elected controlling manager node id (null when none) */
    masterNodeId: text("master_node_id"),

    /** Master election term (monotonic, CAS-guarded — doc-02 §6) */
    masterTerm: integer("master_term").notNull().default(0),

    /** Worker join token (persisted, NOT in `.env` — SW-011) */
    joinTokenWorker: text("join_token_worker"),

    /** Manager join token (persisted, NOT in `.env` — SW-011) */
    joinTokenManager: text("join_token_manager"),

    /** ISO-8601 timestamp of the last cluster heartbeat */
    lastHeartbeatAt: text("last_heartbeat_at"),

    /** ISO-8601 timestamp of last update to this row */
    updatedAt: text("updated_at").notNull(),
});

export type ClusterNodeRow = typeof clusterNode.$inferSelect;
export type ClusterNodeInsert = typeof clusterNode.$inferInsert;