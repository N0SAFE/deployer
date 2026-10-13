import {
  projects2
} from "./migrations-r9ccee18.mjs";

// packages/nest/schema/src/global/project-scan-config.ts
import { boolean, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
var projectScanConfig2 = pgTable("project_scan_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects2.id, { onDelete: "cascade" }).unique(),
  autoScanEnabled: boolean("auto_scan_enabled").notNull().default(false),
  engines: jsonb("engines").$type().notNull().default([]),
  serviceFilters: jsonb("service_filters").$type().default(null),
  lastScanAt: timestamp("last_scan_at"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date).notNull()
});

export { projectScanConfig2 };
