import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const localJobStateEnum = pgEnum("local_job_state", [
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
]);

export const localOutboxStateEnum = pgEnum("local_outbox_state", ["pending", "sent", "failed", "dead_letter"]);

/**
 * Local-only runtime state tables.
 *
 * These tables are intentionally node-scoped and should not be part of cross-instance
 * replication. Keep only cache/runtime/ephemeral execution state here.
 */
export const localQueueJobs = pgTable(
    "local_queue_jobs",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        nodeId: uuid("node_id").notNull(),
        deploymentRunId: uuid("deployment_run_id"),
        jobType: text("job_type").notNull(),
        state: localJobStateEnum("state").default("queued").notNull(),
        attempt: integer("attempt").default(0).notNull(),
        payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
        scheduledAt: timestamp("scheduled_at")
            .$defaultFn(() => new Date())
            .notNull(),
        startedAt: timestamp("started_at"),
        finishedAt: timestamp("finished_at"),
        createdAt: timestamp("created_at")
            .$defaultFn(() => new Date())
            .notNull(),
        updatedAt: timestamp("updated_at")
            .$defaultFn(() => new Date())
            .notNull(),
    },
    (table) => [
        index("local_queue_jobs_node_state_idx").on(table.nodeId, table.state),
        index("local_queue_jobs_deployment_idx").on(table.deploymentRunId),
    ],
);

export const localRuntimeProcesses = pgTable(
    "local_runtime_processes",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        nodeId: uuid("node_id").notNull(),
        deploymentRunId: uuid("deployment_run_id"),
        serviceId: uuid("service_id"),
        containerName: text("container_name"),
        processKey: text("process_key"),
        status: text("status").notNull(),
        metadata: jsonb("metadata").$type<Record<string, unknown>>(),
        startedAt: timestamp("started_at"),
        stoppedAt: timestamp("stopped_at"),
        createdAt: timestamp("created_at")
            .$defaultFn(() => new Date())
            .notNull(),
        updatedAt: timestamp("updated_at")
            .$defaultFn(() => new Date())
            .notNull(),
    },
    (table) => [
        index("local_runtime_processes_node_status_idx").on(table.nodeId, table.status),
        index("local_runtime_processes_service_idx").on(table.serviceId),
    ],
);

export const localBuildCache = pgTable(
    "local_build_cache",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        nodeId: uuid("node_id").notNull(),
        cacheKey: text("cache_key").notNull(),
        storagePath: text("storage_path").notNull(),
        sizeBytes: integer("size_bytes"),
        metadata: jsonb("metadata").$type<Record<string, unknown>>(),
        createdAt: timestamp("created_at")
            .$defaultFn(() => new Date())
            .notNull(),
        expiresAt: timestamp("expires_at"),
    },
    (table) => [
        index("local_build_cache_node_idx").on(table.nodeId),
        index("local_build_cache_cache_key_idx").on(table.cacheKey),
    ],
);

export const localEventOutbox = pgTable(
    "local_event_outbox",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        nodeId: uuid("node_id").notNull(),
        topic: text("topic").notNull(),
        payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
        state: localOutboxStateEnum("state").default("pending").notNull(),
        retryCount: integer("retry_count").default(0).notNull(),
        nextRetryAt: timestamp("next_retry_at"),
        createdAt: timestamp("created_at")
            .$defaultFn(() => new Date())
            .notNull(),
        updatedAt: timestamp("updated_at")
            .$defaultFn(() => new Date())
            .notNull(),
    },
    (table) => [
        index("local_event_outbox_node_state_idx").on(table.nodeId, table.state),
        index("local_event_outbox_topic_idx").on(table.topic),
    ],
);
