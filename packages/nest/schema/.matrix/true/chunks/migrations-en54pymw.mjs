// packages/nest/schema/src/global/node-network-config.ts
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
var nodeNetworkConfig2 = pgTable("node_network_config", {
  nodeId: text("node_id").primaryKey(),
  publicAddress: text("public_address"),
  addressKind: text("address_kind"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date)
});

export { nodeNetworkConfig2 };
