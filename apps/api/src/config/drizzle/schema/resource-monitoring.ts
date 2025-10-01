import { pgTable, text, timestamp, boolean, integer, uuid, jsonb, decimal, pgEnum, } from "drizzle-orm/pg-core";
import { orchestrationStacks, serviceInstances } from "./orchestration";
// Enums for resource monitoring
export const alertSeverityEnum = pgEnum('alert_severity', [
    'info',
    'warning',
    'critical'
]);
export const alertTypeEnum = pgEnum('alert_type', [
    'cpu',
    'memory',
    'storage',
    'network',
    'disk',
    'health'
]);
// Stack metrics - time series data for resource usage
export const stackMetrics = pgTable("stack_metrics", {
    id: uuid("id").primaryKey().defaultRandom(),
    stackId: uuid("stack_id")
        .notNull()
        .references(() => orchestrationStacks.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
        .references(() => serviceInstances.id, { onDelete: "cascade" }), // Can be null for stack-level metrics
    // Resource usage metrics
    cpuUsage: decimal("cpu_usage", { precision: 5, scale: 2 }), // CPU percentage (0-100)
    memoryUsage: decimal("memory_usage", { precision: 12, scale: 0 }), // Memory usage in bytes
    memoryLimit: decimal("memory_limit", { precision: 12, scale: 0 }), // Memory limit in bytes
    storageUsage: decimal("storage_usage", { precision: 12, scale: 0 }), // Storage usage in bytes
    // Network metrics
    networkRx: decimal("network_rx", { precision: 12, scale: 0 }), // Network bytes received
    networkTx: decimal("network_tx", { precision: 12, scale: 0 }), // Network bytes transmitted
    // Disk I/O metrics
    diskRead: decimal("disk_read", { precision: 12, scale: 0 }), // Disk bytes read
    diskWrite: decimal("disk_write", { precision: 12, scale: 0 }), // Disk bytes written
    // Additional metadata
    metadata: jsonb("metadata").$type<{
        collectionMethod?: string;
        containerCount?: number;
        type?: string; // 'service', 'stack', 'system-aggregate'
        activeStacks?: number;
        activeServices?: number;
        [key: string]: any;
    }>(),
    timestamp: timestamp("timestamp")
        .$defaultFn(() => new Date())
        .notNull(),
    createdAt: timestamp("created_at")
        .$defaultFn(() => new Date())
        .notNull(),
});
// Resource alerts - generated when thresholds are exceeded
export const resourceAlerts = pgTable("resource_alerts", {
    id: uuid("id").primaryKey().defaultRandom(),
    stackId: uuid("stack_id")
        .notNull()
        .references(() => orchestrationStacks.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
        .references(() => serviceInstances.id, { onDelete: "cascade" }), // Can be null for stack-level alerts
    // Alert details
    alertType: alertTypeEnum("alert_type").notNull(),
    severity: alertSeverityEnum("severity").notNull(),
    message: text("message").notNull(),
    // Threshold information
    threshold: decimal("threshold", { precision: 10, scale: 2 }).notNull(), // The threshold that was exceeded
    currentValue: decimal("current_value", { precision: 10, scale: 2 }).notNull(), // The current value that triggered the alert
    // Alert status
    isResolved: boolean("is_resolved").default(false).notNull(),
    resolvedAt: timestamp("resolved_at"),
    // Alert metadata
    metadata: jsonb("metadata").$type<{
        generatedBy?: string;
        timestamp?: string;
        additionalInfo?: any;
        [key: string]: any;
    }>(),
    createdAt: timestamp("created_at")
        .$defaultFn(() => new Date())
        .notNull(),
    updatedAt: timestamp("updated_at")
        .$defaultFn(() => new Date())
        .notNull(),
});
// Metric aggregates - pre-computed aggregations for dashboard performance
export const metricAggregates = pgTable("metric_aggregates", {
    id: uuid("id").primaryKey().defaultRandom(),
    stackId: uuid("stack_id")
        .references(() => orchestrationStacks.id, { onDelete: "cascade" }),
    // Aggregation period
    aggregationType: text("aggregation_type").notNull(), // 'hourly', 'daily', 'weekly'
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    // Aggregated metrics
    avgCpuUsage: decimal("avg_cpu_usage", { precision: 5, scale: 2 }),
    maxCpuUsage: decimal("max_cpu_usage", { precision: 5, scale: 2 }),
    minCpuUsage: decimal("min_cpu_usage", { precision: 5, scale: 2 }),
    avgMemoryUsage: decimal("avg_memory_usage", { precision: 12, scale: 0 }),
    maxMemoryUsage: decimal("max_memory_usage", { precision: 12, scale: 0 }),
    minMemoryUsage: decimal("min_memory_usage", { precision: 12, scale: 0 }),
    avgStorageUsage: decimal("avg_storage_usage", { precision: 12, scale: 0 }),
    maxStorageUsage: decimal("max_storage_usage", { precision: 12, scale: 0 }),
    minStorageUsage: decimal("min_storage_usage", { precision: 12, scale: 0 }),
    totalNetworkRx: decimal("total_network_rx", { precision: 12, scale: 0 }),
    totalNetworkTx: decimal("total_network_tx", { precision: 12, scale: 0 }),
    totalDiskRead: decimal("total_disk_read", { precision: 12, scale: 0 }),
    totalDiskWrite: decimal("total_disk_write", { precision: 12, scale: 0 }),
    // Count metrics
    dataPoints: integer("data_points").notNull(), // Number of data points aggregated
    alertCount: integer("alert_count").default(0).notNull(), // Number of alerts in this period
    createdAt: timestamp("created_at")
        .$defaultFn(() => new Date())
        .notNull(),
});
