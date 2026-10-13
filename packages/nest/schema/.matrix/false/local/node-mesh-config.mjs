// packages/nest/schema/src/local/node-mesh-config.ts
import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
var nodeMeshConfig = sqliteTable("node_mesh_config", {
  id: integer("id").primaryKey({ autoIncrement: false }).notNull().$default(() => 1),
  nodeServerUrl: text("node_server_url"),
  bootstrapPeersEncrypted: text("bootstrap_peers_encrypted"),
  syncIntervalMs: integer("sync_interval_ms").notNull().default(1e4),
  trustStrictMinAckRatio: text("trust_strict_min_ack_ratio").notNull().default("1"),
  trustStrictMaxAckAgeSeconds: integer("trust_strict_max_ack_age_seconds").notNull().default(300),
  trustStrictRolloutWaveSize: integer("trust_strict_rollout_wave_size").notNull().default(3),
  trustStrictAutoRollback: integer("trust_strict_auto_rollback", { mode: "boolean" }).notNull().default(false),
  controlEnvelopeTrustRequired: integer("control_envelope_trust_required", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
}, (table) => [check("singleton_check", sql`${table.id} = 1`)]);
export {
  nodeMeshConfig
};
