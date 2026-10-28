import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type { DeploymentQueueJobPayload } from "@deployer/contracts-entities";

export const deploymentQueueJobTypeEnum = pgEnum("deployment_queue_job_type", ["deploy", "rollback", "retry", "reconcile", "cleanup"]);

export const deploymentQueueJobStatusEnum = pgEnum("deployment_queue_job_status", [
	"queued",
	"claimed",
	"running",
	"succeeded",
	"failed",
	"cancelled",
]);

export const deploymentDeadLetterReasonEnum = pgEnum("deployment_dead_letter_reason", [
	"max_attempts_exceeded",
	"non_retryable_error",
	"manual_dead_letter",
	"expired",
	"poison_payload",
]);

/**
 * The runtime's durable job queue. A worker claims a row with `FOR UPDATE SKIP LOCKED`, holds it under a
 * lease it renews with a heartbeat, and an expired lease returns the row to the claimable pool. The
 * runtime is the only writer.
 */
export const deploymentQueueJobs = pgTable(
	"deployment_queue_jobs",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		type: deploymentQueueJobTypeEnum("type").notNull(),
		status: deploymentQueueJobStatusEnum("status").notNull().default("queued"),
		/** One live job per key: enqueueing the same key again returns the existing job. */
		idempotencyKey: text("idempotency_key").notNull(),
		workerId: text("worker_id"),
		lockToken: text("lock_token"),
		payload: jsonb("payload").$type<DeploymentQueueJobPayload>().notNull(),
		/** The deployment this job drives, lifted out of the payload so it can be indexed and looked up. */
		deploymentId: uuid("deployment_id"),
		attempts: integer("attempts").notNull().default(0),
		maxAttempts: integer("max_attempts").notNull().default(5),
		availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
		lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
		leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
		connectivityStatus: text("connectivity_status"),
		startedAt: timestamp("started_at", { withTimezone: true }),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		lastError: text("last_error"),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex("deployment_queue_jobs_idempotency_key_idx").on(table.idempotencyKey),
		index("deployment_queue_jobs_claim_idx").on(table.status, table.availableAt),
		index("deployment_queue_jobs_lease_idx").on(table.status, table.leaseExpiresAt),
		index("deployment_queue_jobs_deployment_idx").on(table.deploymentId),
	],
);

/** Jobs that will not be retried automatically; an operator can replay them. */
export const deploymentDeadLetterJobs = pgTable(
	"deployment_dead_letter_jobs",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		originalJobId: uuid("original_job_id").notNull(),
		idempotencyKey: text("idempotency_key").notNull(),
		type: deploymentQueueJobTypeEnum("type").notNull(),
		payload: jsonb("payload").$type<DeploymentQueueJobPayload>().notNull(),
		reason: deploymentDeadLetterReasonEnum("reason").notNull(),
		attempts: integer("attempts").notNull(),
		maxAttempts: integer("max_attempts").notNull(),
		lastError: text("last_error"),
		movedAt: timestamp("moved_at", { withTimezone: true }).notNull().defaultNow(),
		movedBy: text("moved_by"),
		replayCount: integer("replay_count").notNull().default(0),
		lastReplayAt: timestamp("last_replay_at", { withTimezone: true }),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
	},
	(table) => [index("deployment_dead_letter_jobs_moved_idx").on(table.movedAt)],
);
