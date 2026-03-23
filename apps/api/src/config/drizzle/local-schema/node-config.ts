import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Stores node-level configuration that persists between restarts.
 * Single-row table (id = 1 always).
 * Managed by the local SQLite database — no Postgres required.
 */
export const nodeConfig = sqliteTable("node_config", {
    id: integer("id").primaryKey({ autoIncrement: false }).notNull().$default(() => 1),
    /** Connection URL for the global Postgres database */
    databaseUrl: text("database_url"),
    /** UUID identifying this node in the mesh */
    nodeId: text("node_id").notNull(),
    /** ISO-8601 timestamp when the node was first configured */
    configuredAt: text("configured_at").notNull(),
    /** ISO-8601 timestamp of last update to this row */
    updatedAt: text("updated_at").notNull(),
});

export type NodeConfigRow = typeof nodeConfig.$inferSelect;
export type NewNodeConfigRow = typeof nodeConfig.$inferInsert;
