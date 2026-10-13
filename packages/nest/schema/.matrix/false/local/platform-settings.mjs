// packages/nest/schema/src/local/platform-settings.ts
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
var platformSettings = sqliteTable("platform_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull()
});
export {
  platformSettings
};
