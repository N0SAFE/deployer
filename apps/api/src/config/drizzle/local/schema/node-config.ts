import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Setup state machine for the node startup protocol.
 *
 * States:
 *   not_started       — Node has never been set up. Setup wizard required.
 *   setup_in_progress — Setup wizard is actively running.
 *   setup_done        — Setup completed successfully. Normal operation.
 *   upgrade_pending   — Setup done, but a version mismatch was detected
 *                       and the upgrade protocol is running.
 *   upgrade_in_progress — Upgrade is actively being applied across the mesh.
 *   upgrade_failed    — Upgrade was attempted but failed. Manual intervention
 *                       or rollback needed.
 */
export type SetupState =
  | "not_started"
  | "setup_in_progress"
  | "setup_done"
  | "upgrade_pending"
  | "upgrade_in_progress"
  | "upgrade_failed";

/**
 * Stores node-level configuration that persists between restarts.
 * Single-row table (id = 1 always).
 * Managed by the local SQLite database — no Postgres required.
 */
export const nodeConfig = sqliteTable("node_config", {
    id: integer("id")
        .primaryKey({ autoIncrement: false })
        .notNull()
        .$default(() => 1),

    /** UUID identifying this node in the mesh */
    nodeId: text("node_id").notNull(),

    /** Bootstrap strategy: "local" or "remote" */
    strategy: text("strategy", { enum: ["local", "remote"] }).notNull(),

    /**
     * Current state of the node setup protocol.
     * Determines which path the startup coordinator takes.
     * Defaults to "not_started" for fresh installs.
     */
    setupState: text("setup_state", {
      enum: ["not_started", "setup_in_progress", "setup_done", "upgrade_pending", "upgrade_in_progress", "upgrade_failed"],
    }).notNull().default("not_started"),

    /**
     * The deployer version (apps/api/package.json) at the time of setup.
     * Compared against mesh peers on every startup to detect version drift.
     * Null on nodes that have never completed setup.
     */
    deployerVersion: text("deployer_version"),

    /**
     * The deployer version (apps/api/package.json) at the time of the
     * last successful upgrade. Compared against deployerVersion to
     * determine whether an upgrade is in progress.
     * Null on nodes that have never been upgraded.
     */
    upgradedAtVersion: text("upgraded_at_version"),

    /** Mesh bootstrap URL snapshot, stored locally for reconnect order */
    meshUrlsSnapshot: text("mesh_urls_snapshot", { mode: "json" }).$type<string[]>(),
    
    /** Stored database URL (null for not-yet-configured nodes) */
    databaseUrl: text("database_url"),

    /** ISO-8601 timestamp when the node was first configured (null if not configured) */
    configuredAt: text("configured_at"),

    /**
     * Long-lived peer service token issued by the remote mesh during
     * `consumeJoinGrant`. Presented as `X-Mesh-Internal-Key` on every
     * subsequent peer-to-peer mesh call. Persisted here so the token
     * survives restarts of the local node without re-enrollment.
     * Null on nodes that have not (yet) joined a remote mesh.
     */
    peerServiceToken: text("peer_service_token"),

    /**
     * ISO-8601 timestamp at which `peerServiceToken` stops being accepted
     * by the remote mesh. Used to surface expiring tokens in the UI /
     * healthchecks. Null alongside `peerServiceToken`.
     */
    peerServiceTokenExpiresAt: text("peer_service_token_expires_at"),

    /** ISO-8601 timestamp of last update to this row */
    updatedAt: text("updated_at").notNull(),

    /**
     * The mesh shared secret used by `requireMesh()` / `requireInternalMesh()`
     * to verify peer credentials. Generated at setup time and persisted so
     * the node can validate mesh requests across restarts without re-reading
     * the env var (which may not be set on mesh nodes).
     *
     * Null on nodes that have not yet been configured / joined a mesh.
     */
    meshSharedSecret: text("mesh_shared_secret"),

    /**
     * ISO-8601 timestamp when `meshSharedSecret` was last rotated.
     * Null if the secret has never been set.
     */
    meshSharedSecretUpdatedAt: text("mesh_shared_secret_updated_at"),
});

export type NodeConfigRow = typeof nodeConfig.$inferSelect;
export type NewNodeConfigRow = typeof nodeConfig.$inferInsert;

export type NodeConfigRow = typeof nodeConfig.$inferSelect;
export type NewNodeConfigRow = typeof nodeConfig.$inferInsert;