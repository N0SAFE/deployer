import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Analytics reports + scheduled report configurations.
 *
 * The analytics feature is honest about persistence: `generateReport` stores
 * the produced JSON report as a row (`analytics_reports`) instead of returning
 * a fake "pending" hand-wave. `downloadReport` streams that stored JSON back to
 * the client as an attachment.
 */

export const analyticsReportStatusEnum = pgEnum("analytics_report_status", [
    "pending",
    "generating",
    "completed",
    "failed",
]);

export const analyticsReportFormatEnum = pgEnum("analytics_report_format", [
    "json",
    "pdf",
    "csv",
]);

/** A generated analytics report (JSON content persisted at generation time). */
export const analyticsReports = pgTable(
    "analytics_reports",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        /** Human label, e.g. "Weekly performance — 2026-08-24 → 2026-08-30". */
        name: text("name").notNull(),
        status: analyticsReportStatusEnum("status").default("pending").notNull(),
        format: analyticsReportFormatEnum("format").default("json").notNull(),
        periodStart: timestamp("period_start").notNull(),
        periodEnd: timestamp("period_end").notNull(),
        /** Report sections that were requested at generation time. */
        sections: jsonb("sections").$type<string[]>().default([]),
        /** The full report payload (analyticsReportSchema shape) for JSON/csv. */
        content: jsonb("content").$type<unknown>(),
        sizeBytes: integer("size_bytes").default(0),
        errorMessage: text("error_message"),
        generatedAt: timestamp("generated_at"),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
        index("analytics_reports_status_idx").on(table.status),
        index("analytics_reports_period_start_idx").on(table.periodStart),
    ],
);

export const analyticsReportConfigScheduleEnum = pgEnum("analytics_report_config_schedule", [
    "none",
    "daily",
    "weekly",
    "monthly",
]);

/** A saved report configuration (schedule + metric selection + recipients). */
export const analyticsReportConfigs = pgTable(
    "analytics_report_configs",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        name: text("name").notNull(),
        description: text("description"),
        /** Metric keys included, e.g. ["resourceUsage", "deploymentAnalytics"]. */
        metrics: jsonb("metrics").$type<string[]>().notNull(),
        filters: jsonb("filters").$type<Record<string, unknown>>(),
        schedule: analyticsReportConfigScheduleEnum("schedule").default("none").notNull(),
        recipients: jsonb("recipients").$type<string[]>().default([]),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => [
        index("analytics_report_configs_schedule_idx").on(table.schedule),
    ],
);