// packages/nest/schema/src/global/gitlab-provider.ts
import { pgTable, text, timestamp, boolean, uuid } from "drizzle-orm/pg-core";
import { encryptedText } from "@deployer/nest-schema/codecs/codec-registry";
var gitlabApps = pgTable("gitlab_apps", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  accessToken: encryptedText("access_token").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date).notNull()
}, (table) => []);
export {
  gitlabApps
};
