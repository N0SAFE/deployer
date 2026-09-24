import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Fleet node inventory (SW-030) — one row per Swarm node, persisted from
 * `docker node ls` (SDK) so the UI/ops + drift reconciliation have a
 * queryable snapshot WITHOUT a live engine call every time.
 *
 * Local SQLite per node: the local engine's view of the fleet is the
 * source of truth for THIS node; cross-node coordination remains the mesh.
 */
export const clusterNodes = sqliteTable("cluster_nodes", {
    /** Swarm node id (engine truth; the table PK). */
    nodeId: text("node_id").primaryKey(),

    hostname: text("hostname").notNull().default(""),

    /** Swarm role: manager | worker */
    swarmRole: text("swarm_role", { enum: ["manager", "worker"] }).notNull().default("worker"),

    /** Platform role: both | control | worker (default both — shared nodes, doc-04) */
    platformRole: text("platform_role", { enum: ["both", "control", "worker"] }).notNull().default("both"),

    /** Raft leader → de-facto master (until mesh election P4 takes over). */
    isLeader: integer("is_leader", { mode: "boolean" }).notNull().default(false),

    /** Node carries the ingress label (`deployer.ingress=true`). */
    isIngress: integer("is_ingress", { mode: "boolean" }).notNull().default(false),

    /** Node availability: active | pause | drain */
    availability: text("availability", { enum: ["active", "pause", "drain"] }).notNull().default("active"),

    /** Engine-reported capacity (nullable when unknown). */
    nanoCpus: integer("nano_cpus"),
    memoryBytes: integer("memory_bytes"),

    /** Node labels snapshot (JSON-encoded record). */
    labels: text("labels", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),

    /** Inventory state: active when seen in the latest sweep, down when missing. */
    state: text("state", { enum: ["active", "down"] }).notNull().default("active"),

    /** ISO-8601 last time the node was observed by the sync sweep. */
    lastSeenAt: text("last_seen_at").notNull(),

    /** ISO-8601 last update to this row. */
    updatedAt: text("updated_at").notNull(),
});

export type ClusterNodesRow = typeof clusterNodes.$inferSelect;
export type ClusterNodesInsert = typeof clusterNodes.$inferInsert;