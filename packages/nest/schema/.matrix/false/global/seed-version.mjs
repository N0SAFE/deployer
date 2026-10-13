// packages/nest/schema/src/global/seed-version.ts
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
var seedVersion = pgTable("seed_version", {
  version: text("version").primaryKey(),
  appliedAt: timestamp("applied_at").defaultNow().notNull()
});
export {
  seedVersion
};
