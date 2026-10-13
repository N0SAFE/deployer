// packages/nest/schema/src/local/node-config.ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
var nodeConfig = sqliteTable("node_config", {
  id: integer("id").primaryKey({ autoIncrement: false }).notNull().$default(() => 1),
  nodeId: text("node_id").notNull(),
  strategy: text("strategy", { enum: ["local", "remote"] }).notNull(),
  setupState: text("setup_state", {
    enum: ["not_started", "setup_in_progress", "setup_done", "upgrade_pending", "upgrade_in_progress", "upgrade_failed"]
  }).notNull().default("not_started"),
  deployerVersion: text("deployer_version"),
  upgradedAtVersion: text("upgraded_at_version"),
  meshUrlsSnapshot: text("mesh_urls_snapshot", { mode: "json" }).$type(),
  databaseUrl: text("database_url"),
  databaseProvisioning: text("database_provisioning", {
    enum: ["local", "external"]
  }),
  configuredAt: text("configured_at"),
  peerServiceToken: text("peer_service_token"),
  peerServiceTokenExpiresAt: text("peer_service_token_expires_at"),
  updatedAt: text("updated_at").notNull(),
  meshSharedSecret: text("mesh_shared_secret"),
  meshSharedSecretUpdatedAt: text("mesh_shared_secret_updated_at"),
  scanConfig: text("scan_config", { mode: "json" }).$type(),
  postSetupFlags: text("post_setup_flags", { mode: "json" }).$type(),
  swarmConfig: text("swarm_config", { mode: "json" }).$type()
});
export {
  nodeConfig
};
