// packages/nest/schema/src/local/cluster-master-history.ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
var clusterMasterHistory = sqliteTable("cluster_master_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  nodeId: text("node_id").notNull(),
  term: integer("term").notNull(),
  electedAt: text("elected_at").notNull(),
  reason: text("reason"),
  durationMs: integer("duration_ms")
});
export {
  clusterMasterHistory
};
