CREATE TYPE "public"."job_status" AS ENUM('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('deploy', 'update', 'remove', 'scale', 'build', 'cleanup', 'health-check', 'ssl-renew', 'backup', 'restore');--> statement-breakpoint
CREATE TABLE "job_tracking" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "job_type" NOT NULL,
	"status" "job_status" NOT NULL,
	"stack_id" uuid,
	"service_id" uuid,
	"data" jsonb,
	"progress" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"failed_at" timestamp,
	"duration" integer,
	"logs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"metadata" jsonb,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_tracking" ADD CONSTRAINT "job_tracking_stack_id_orchestration_stacks_id_fk" FOREIGN KEY ("stack_id") REFERENCES "public"."orchestration_stacks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_tracking" ADD CONSTRAINT "job_tracking_service_id_service_instances_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_instances"("id") ON DELETE set null ON UPDATE no action;