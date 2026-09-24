import { boolean, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { projects } from "./deployment";

export const projectScanConfig = pgTable("project_scan_config", {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
        .notNull()
        .references(() => projects.id, { onDelete: "cascade" })
        .unique(),
    autoScanEnabled: boolean("auto_scan_enabled").notNull().default(false),
    engines: jsonb("engines").$type<string[]>().notNull().default([]),
    serviceFilters: jsonb("service_filters").$type<{ include: string[]; exclude: string[] } | null>().default(null),
    lastScanAt: timestamp("last_scan_at"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
    updatedAt: timestamp("updated_at").$defaultFn(() => new Date()).notNull(),
});
