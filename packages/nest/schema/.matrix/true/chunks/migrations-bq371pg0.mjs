// packages/nest/schema/src/local/cluster-nodes.ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
var clusterNodes3 = sqliteTable("cluster_nodes", {
  nodeId: text("node_id").primaryKey(),
  hostname: text("hostname").notNull().default(""),
  swarmRole: text("swarm_role", { enum: ["manager", "worker"] }).notNull().default("worker"),
  platformRole: text("platform_role", { enum: ["both", "control", "worker"] }).notNull().default("both"),
  isLeader: integer("is_leader", { mode: "boolean" }).notNull().default(false),
  isIngress: integer("is_ingress", { mode: "boolean" }).notNull().default(false),
  availability: text("availability", { enum: ["active", "pause", "drain"] }).notNull().default("active"),
  nanoCpus: integer("nano_cpus"),
  memoryBytes: integer("memory_bytes"),
  labels: text("labels", { mode: "json" }).$type().notNull().default({}),
  state: text("state", { enum: ["active", "down"] }).notNull().default("active"),
  lastSeenAt: text("last_seen_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export { clusterNodes3 };
