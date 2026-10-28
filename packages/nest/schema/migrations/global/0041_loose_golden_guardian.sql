CREATE TYPE "public"."deployment_dead_letter_reason" AS ENUM('max_attempts_exceeded', 'non_retryable_error', 'manual_dead_letter', 'expired', 'poison_payload');--> statement-breakpoint
CREATE TYPE "public"."deployment_queue_job_status" AS ENUM('queued', 'claimed', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."deployment_queue_job_type" AS ENUM('deploy', 'rollback', 'retry', 'reconcile', 'cleanup');--> statement-breakpoint
CREATE TABLE "deployment_dead_letter_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"original_job_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"type" "deployment_queue_job_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"reason" "deployment_dead_letter_reason" NOT NULL,
	"attempts" integer NOT NULL,
	"max_attempts" integer NOT NULL,
	"last_error" text,
	"moved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"moved_by" text,
	"replay_count" integer DEFAULT 0 NOT NULL,
	"last_replay_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "deployment_queue_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "deployment_queue_job_type" NOT NULL,
	"status" "deployment_queue_job_status" DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"worker_id" text,
	"lock_token" text,
	"payload" jsonb NOT NULL,
	"deployment_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"connectivity_status" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "deployment_dead_letter_jobs_moved_idx" ON "deployment_dead_letter_jobs" USING btree ("moved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deployment_queue_jobs_idempotency_key_idx" ON "deployment_queue_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "deployment_queue_jobs_claim_idx" ON "deployment_queue_jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "deployment_queue_jobs_lease_idx" ON "deployment_queue_jobs" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "deployment_queue_jobs_deployment_idx" ON "deployment_queue_jobs" USING btree ("deployment_id");