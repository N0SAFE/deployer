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
// packages/nest/schema/src/local/node-mesh-config.ts
import { sql } from "drizzle-orm";
import { check, integer as integer2, sqliteTable as sqliteTable2, text as text2 } from "drizzle-orm/sqlite-core";
var nodeMeshConfig = sqliteTable2("node_mesh_config", {
  id: integer2("id").primaryKey({ autoIncrement: false }).notNull().$default(() => 1),
  nodeServerUrl: text2("node_server_url"),
  bootstrapPeersEncrypted: text2("bootstrap_peers_encrypted"),
  syncIntervalMs: integer2("sync_interval_ms").notNull().default(1e4),
  trustStrictMinAckRatio: text2("trust_strict_min_ack_ratio").notNull().default("1"),
  trustStrictMaxAckAgeSeconds: integer2("trust_strict_max_ack_age_seconds").notNull().default(300),
  trustStrictRolloutWaveSize: integer2("trust_strict_rollout_wave_size").notNull().default(3),
  trustStrictAutoRollback: integer2("trust_strict_auto_rollback", { mode: "boolean" }).notNull().default(false),
  controlEnvelopeTrustRequired: integer2("control_envelope_trust_required", { mode: "boolean" }).notNull().default(false),
  createdAt: text2("created_at").notNull(),
  updatedAt: text2("updated_at").notNull()
}, (table) => [check("singleton_check", sql`${table.id} = 1`)]);
// packages/nest/schema/src/local/platform-settings.ts
import { sqliteTable as sqliteTable3, text as text3 } from "drizzle-orm/sqlite-core";
var platformSettings = sqliteTable3("platform_settings", {
  key: text3("key").primaryKey(),
  value: text3("value").notNull(),
  updatedAt: text3("updated_at").notNull()
});
// packages/nest/schema/src/local/cluster-node.ts
import { integer as integer4, sqliteTable as sqliteTable4, text as text4 } from "drizzle-orm/sqlite-core";
var clusterNode = sqliteTable4("cluster_node", {
  id: integer4("id").primaryKey({ autoIncrement: false }).notNull().$default(() => 1),
  clusterId: text4("cluster_id"),
  localNodeState: text4("local_node_state", {
    enum: ["inactive", "pending", "active", "error", "locked"]
  }),
  swarmRole: text4("swarm_role", { enum: ["manager", "worker", "none"] }),
  platformRole: text4("platform_role", { enum: ["both", "control", "worker"] }).notNull().default("both"),
  isMaster: integer4("is_master", { mode: "boolean" }).notNull().default(false),
  isIngress: integer4("is_ingress", { mode: "boolean" }).notNull().default(false),
  availability: text4("availability", { enum: ["active", "pause", "drain"] }).notNull().default("active"),
  nodeCount: integer4("node_count").notNull().default(0),
  managerCount: integer4("manager_count").notNull().default(0),
  masterNodeId: text4("master_node_id"),
  masterTerm: integer4("master_term").notNull().default(0),
  joinTokenWorker: text4("join_token_worker"),
  joinTokenManager: text4("join_token_manager"),
  lastHeartbeatAt: text4("last_heartbeat_at"),
  updatedAt: text4("updated_at").notNull()
});
// packages/nest/schema/src/local/cluster-master-history.ts
import { integer as integer5, sqliteTable as sqliteTable5, text as text5 } from "drizzle-orm/sqlite-core";
var clusterMasterHistory = sqliteTable5("cluster_master_history", {
  id: integer5("id").primaryKey({ autoIncrement: true }),
  nodeId: text5("node_id").notNull(),
  term: integer5("term").notNull(),
  electedAt: text5("elected_at").notNull(),
  reason: text5("reason"),
  durationMs: integer5("duration_ms")
});
// packages/nest/schema/src/local/cluster-nodes.ts
import { integer as integer6, sqliteTable as sqliteTable6, text as text6 } from "drizzle-orm/sqlite-core";
var clusterNodes = sqliteTable6("cluster_nodes", {
  nodeId: text6("node_id").primaryKey(),
  hostname: text6("hostname").notNull().default(""),
  swarmRole: text6("swarm_role", { enum: ["manager", "worker"] }).notNull().default("worker"),
  platformRole: text6("platform_role", { enum: ["both", "control", "worker"] }).notNull().default("both"),
  isLeader: integer6("is_leader", { mode: "boolean" }).notNull().default(false),
  isIngress: integer6("is_ingress", { mode: "boolean" }).notNull().default(false),
  availability: text6("availability", { enum: ["active", "pause", "drain"] }).notNull().default("active"),
  nanoCpus: integer6("nano_cpus"),
  memoryBytes: integer6("memory_bytes"),
  labels: text6("labels", { mode: "json" }).$type().notNull().default({}),
  state: text6("state", { enum: ["active", "down"] }).notNull().default("active"),
  lastSeenAt: text6("last_seen_at").notNull(),
  updatedAt: text6("updated_at").notNull()
});
export {
  clusterMasterHistory,
  clusterNode,
  clusterNodes,
  nodeConfig,
  nodeMeshConfig,
  platformSettings
};
