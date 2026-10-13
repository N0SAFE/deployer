// packages/nest/schema/src/global/analytics.ts
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
var analyticsReportStatusEnum = pgEnum("analytics_report_status", [
  "pending",
  "generating",
  "completed",
  "failed"
]);
var analyticsReportFormatEnum = pgEnum("analytics_report_format", [
  "json",
  "pdf",
  "csv"
]);
var analyticsReports = pgTable("analytics_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  status: analyticsReportStatusEnum("status").default("pending").notNull(),
  format: analyticsReportFormatEnum("format").default("json").notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  sections: jsonb("sections").$type().default([]),
  content: jsonb("content").$type(),
  sizeBytes: integer("size_bytes").default(0),
  errorMessage: text("error_message"),
  generatedAt: timestamp("generated_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow()
}, (table) => [
  index("analytics_reports_status_idx").on(table.status),
  index("analytics_reports_period_start_idx").on(table.periodStart)
]);
var analyticsReportConfigScheduleEnum = pgEnum("analytics_report_config_schedule", [
  "none",
  "daily",
  "weekly",
  "monthly"
]);
var analyticsReportConfigs = pgTable("analytics_report_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  metrics: jsonb("metrics").$type().notNull(),
  filters: jsonb("filters").$type(),
  schedule: analyticsReportConfigScheduleEnum("schedule").default("none").notNull(),
  recipients: jsonb("recipients").$type().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow()
}, (table) => [
  index("analytics_report_configs_schedule_idx").on(table.schedule)
]);
export {
  analyticsReportConfigScheduleEnum,
  analyticsReportConfigs,
  analyticsReportFormatEnum,
  analyticsReportStatusEnum,
  analyticsReports
};
