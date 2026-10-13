import {
  services2
} from "./migrations-r9ccee18.mjs";

// packages/nest/schema/src/global/health.ts
import { pgTable, uuid, text, timestamp, boolean, integer, jsonb, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
var healthChecks2 = pgTable("health_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  serviceId: uuid("service_id").notNull().references(() => services2.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["healthy", "unhealthy", "unknown", "starting"] }).notNull(),
  message: text("message").notNull(),
  details: jsonb("details"),
  responseTime: integer("response_time"),
  checkType: text("check_type", { enum: ["http", "tcp", "docker", "command", "disabled"] }).notNull(),
  checkConfig: jsonb("check_config").notNull(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [index("health_checks_service_id_idx").on(table.serviceId), index("health_checks_checked_at_idx").on(table.checkedAt), index("health_checks_status_idx").on(table.status)]);
var serviceHealthConfigs2 = pgTable("service_health_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  serviceId: uuid("service_id").notNull().unique().references(() => services2.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  checkType: text("check_type", { enum: ["http", "tcp", "docker", "command", "disabled"] }).notNull().default("http"),
  interval: integer("interval").notNull().default(60),
  timeout: integer("timeout").notNull().default(30),
  retries: integer("retries").notNull().default(3),
  startPeriod: integer("start_period").notNull().default(60),
  config: jsonb("config").notNull(),
  alertOnFailure: boolean("alert_on_failure").notNull().default(true),
  alertWebhookUrl: text("alert_webhook_url"),
  alertEmail: text("alert_email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [index("service_health_configs_service_id_idx").on(table.serviceId)]);
var healthCheckJobs2 = pgTable("health_check_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  cronExpression: text("cron_expression").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  batchSize: integer("batch_size").notNull().default(10),
  timeout: integer("timeout").notNull().default(300),
  lastRun: timestamp("last_run", { withTimezone: true }),
  nextRun: timestamp("next_run", { withTimezone: true }),
  runCount: integer("run_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});
var healthChecksRelations2 = relations(healthChecks2, ({ one }) => ({
  service: one(services2, {
    fields: [healthChecks2.serviceId],
    references: [services2.id]
  }),
  serviceHealthConfig: one(serviceHealthConfigs2, {
    fields: [healthChecks2.serviceId],
    references: [serviceHealthConfigs2.serviceId]
  })
}));
var serviceHealthConfigsRelations2 = relations(serviceHealthConfigs2, ({ one, many }) => ({
  service: one(services2, {
    fields: [serviceHealthConfigs2.serviceId],
    references: [services2.id]
  }),
  healthChecks: many(healthChecks2)
}));

export { healthChecks2, serviceHealthConfigs2, healthCheckJobs2, healthChecksRelations2, serviceHealthConfigsRelations2 };
