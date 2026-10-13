// packages/nest/schema/src/local/cluster-node.ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
var clusterNode = sqliteTable("cluster_node", {
  id: integer("id").primaryKey({ autoIncrement: false }).notNull().$default(() => 1),
  clusterId: text("cluster_id"),
  localNodeState: text("local_node_state", {
    enum: ["inactive", "pending", "active", "error", "locked"]
  }),
  swarmRole: text("swarm_role", { enum: ["manager", "worker", "none"] }),
  platformRole: text("platform_role", { enum: ["both", "control", "worker"] }).notNull().default("both"),
  isMaster: integer("is_master", { mode: "boolean" }).notNull().default(false),
  isIngress: integer("is_ingress", { mode: "boolean" }).notNull().default(false),
  availability: text("availability", { enum: ["active", "pause", "drain"] }).notNull().default("active"),
  nodeCount: integer("node_count").notNull().default(0),
  managerCount: integer("manager_count").notNull().default(0),
  masterNodeId: text("master_node_id"),
  masterTerm: integer("master_term").notNull().default(0),
  joinTokenWorker: text("join_token_worker"),
  joinTokenManager: text("join_token_manager"),
  lastHeartbeatAt: text("last_heartbeat_at"),
  updatedAt: text("updated_at").notNull()
});
export {
  clusterNode
};
