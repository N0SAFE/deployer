import { pgTable, uuid, text, timestamp, boolean, integer, jsonb, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { services } from './deployment';
// Health check results table
export const healthChecks = pgTable('health_checks', {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceId: uuid('service_id').notNull(),
    // Health check result data
    status: text('status', { enum: ['healthy', 'unhealthy', 'unknown', 'starting'] }).notNull(),
    message: text('message').notNull(),
    details: jsonb('details'), // Additional details about the check (response times, error codes, etc.)
    responseTime: integer('response_time'), // milliseconds
    // Check configuration used
    checkType: text('check_type', { enum: ['http', 'tcp', 'docker', 'command', 'disabled'] }).notNull(),
    checkConfig: jsonb('check_config').notNull(), // The configuration used for this check
    // Timing
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
    serviceIdIdx: index('health_checks_service_id_idx').on(table.serviceId),
    checkedAtIdx: index('health_checks_checked_at_idx').on(table.checkedAt),
    statusIdx: index('health_checks_status_idx').on(table.status),
}));
// Service health configuration table (stored as part of service configuration)
export const serviceHealthConfigs = pgTable('service_health_configs', {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceId: uuid('service_id').notNull().unique(),
    // Basic configuration
    enabled: boolean('enabled').notNull().default(true),
    checkType: text('check_type', { enum: ['http', 'tcp', 'docker', 'command', 'disabled'] }).notNull().default('http'),
    // Timing configuration
    interval: integer('interval').notNull().default(60), // seconds
    timeout: integer('timeout').notNull().default(30), // seconds
    retries: integer('retries').notNull().default(3),
    startPeriod: integer('start_period').notNull().default(60), // grace period in seconds
    // Type-specific configuration
    config: jsonb('config').notNull(), // Contains http/tcp/docker/command specific config
    // Notification settings
    alertOnFailure: boolean('alert_on_failure').notNull().default(true),
    alertWebhookUrl: text('alert_webhook_url'),
    alertEmail: text('alert_email'),
    // Metadata
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
    serviceIdIdx: index('service_health_configs_service_id_idx').on(table.serviceId),
}));
// Cron job configuration for health checks
export const healthCheckJobs = pgTable('health_check_jobs', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),
    cronExpression: text('cron_expression').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    // Job configuration
    batchSize: integer('batch_size').notNull().default(10), // How many services to check in parallel
    timeout: integer('timeout').notNull().default(300), // Total job timeout in seconds
    // Metadata
    lastRun: timestamp('last_run', { withTimezone: true }),
    nextRun: timestamp('next_run', { withTimezone: true }),
    runCount: integer('run_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
// Relations
export const healthChecksRelations = relations(healthChecks, ({ one }) => ({
    service: one(services, {
        fields: [healthChecks.serviceId],
        references: [services.id],
    }),
    serviceHealthConfig: one(serviceHealthConfigs, {
        fields: [healthChecks.serviceId],
        references: [serviceHealthConfigs.serviceId],
    }),
}));
export const serviceHealthConfigsRelations = relations(serviceHealthConfigs, ({ one, many }) => ({
    service: one(services, {
        fields: [serviceHealthConfigs.serviceId],
        references: [services.id],
    }),
    healthChecks: many(healthChecks),
}));
