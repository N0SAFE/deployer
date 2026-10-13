// packages/nest/schema/src/global/app-config.ts
import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
var appConfig2 = pgTable("app_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedBy: text("updated_by")
}, (table) => [
  index("app_config_key_idx").on(table.key)
]);

export { appConfig2 };
