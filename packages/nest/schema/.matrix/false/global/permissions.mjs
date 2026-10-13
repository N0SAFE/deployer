// packages/nest/schema/src/global/permissions.ts
import {
  pgTable,
  text,
  jsonb,
  timestamp,
  uniqueIndex
} from "drizzle-orm/pg-core";
var roleRules = pgTable("role_rules", {
  id: text("id").primaryKey(),
  roleName: text("role_name").notNull(),
  resourceRules: jsonb("resource_rules").$type().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().$onUpdate(() => new Date)
}, (table) => [
  uniqueIndex("role_rules_roleName_uidx").on(table.roleName)
]);
export {
  roleRules
};
