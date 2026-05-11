CREATE TYPE "public"."docker_image_lifecycle_state" AS ENUM('alive', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."docker_image_security_scan_status" AS ENUM('completed', 'error');--> statement-breakpoint
CREATE TYPE "public"."docker_runtime_activity_category" AS ENUM('image-scanning', 'runtime-event');--> statement-breakpoint
CREATE TYPE "public"."docker_runtime_activity_severity" AS ENUM('info', 'warning', 'error');--> statement-breakpoint
CREATE TYPE "public"."docker_runtime_activity_status" AS ENUM('queued', 'running', 'completed', 'error', 'info');--> statement-breakpoint
CREATE TABLE "docker_image_security_lifecycle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_identifier_normalized" text NOT NULL,
	"current_generation" integer DEFAULT 1 NOT NULL,
	"lifecycle_state" "docker_image_lifecycle_state" DEFAULT 'alive' NOT NULL,
	"first_seen_at" timestamp NOT NULL,
	"last_seen_at" timestamp NOT NULL,
	"deleted_at" timestamp,
	"revived_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docker_image_security_scan_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_id" text NOT NULL,
	"image_identifier_normalized" text NOT NULL,
	"image_generation" integer DEFAULT 1 NOT NULL,
	"scan_hash" text NOT NULL,
	"vulnerabilities" jsonb NOT NULL,
	"scan_summary" jsonb NOT NULL,
	"scan_status" "docker_image_security_scan_status" DEFAULT 'completed' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docker_runtime_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_fingerprint" text NOT NULL,
	"event_id" text,
	"flow_id" text NOT NULL,
	"depends_on_flow_id" text,
	"source" text NOT NULL,
	"action" text NOT NULL,
	"actor_id" text,
	"status" "docker_runtime_activity_status" DEFAULT 'info' NOT NULL,
	"category" "docker_runtime_activity_category" DEFAULT 'runtime-event' NOT NULL,
	"severity" "docker_runtime_activity_severity" DEFAULT 'info' NOT NULL,
	"progress" integer,
	"stage" text,
	"scanner" text,
	"message" text,
	"actor_attributes" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"raw" jsonb NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
DROP INDEX "docker_image_security_scans_identifier_uidx";--> statement-breakpoint
ALTER TABLE "docker_image_security_scans" ADD COLUMN "image_generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "docker_image_security_scans" ADD COLUMN "scan_status" "docker_image_security_scan_status" DEFAULT 'completed' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "docker_image_security_lifecycle_identifier_uidx" ON "docker_image_security_lifecycle" USING btree ("image_identifier_normalized");--> statement-breakpoint
CREATE INDEX "docker_image_security_lifecycle_state_idx" ON "docker_image_security_lifecycle" USING btree ("lifecycle_state");--> statement-breakpoint
CREATE INDEX "docker_image_security_lifecycle_last_seen_idx" ON "docker_image_security_lifecycle" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "docker_image_security_scan_history_scan_hash_uidx" ON "docker_image_security_scan_history" USING btree ("scan_hash");--> statement-breakpoint
CREATE INDEX "docker_image_security_scan_history_identifier_idx" ON "docker_image_security_scan_history" USING btree ("image_identifier_normalized");--> statement-breakpoint
CREATE INDEX "docker_image_security_scan_history_generation_idx" ON "docker_image_security_scan_history" USING btree ("image_identifier_normalized","image_generation");--> statement-breakpoint
CREATE INDEX "docker_image_security_scan_history_created_idx" ON "docker_image_security_scan_history" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "docker_runtime_activities_fingerprint_uidx" ON "docker_runtime_activities" USING btree ("event_fingerprint");--> statement-breakpoint
CREATE INDEX "docker_runtime_activities_occurred_idx" ON "docker_runtime_activities" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "docker_runtime_activities_flow_idx" ON "docker_runtime_activities" USING btree ("flow_id");--> statement-breakpoint
CREATE INDEX "docker_runtime_activities_category_idx" ON "docker_runtime_activities" USING btree ("category");--> statement-breakpoint
CREATE INDEX "docker_runtime_activities_status_idx" ON "docker_runtime_activities" USING btree ("status");--> statement-breakpoint
CREATE INDEX "docker_runtime_activities_source_action_idx" ON "docker_runtime_activities" USING btree ("source","action");--> statement-breakpoint
CREATE UNIQUE INDEX "docker_image_security_scans_identifier_generation_uidx" ON "docker_image_security_scans" USING btree ("image_identifier_normalized","image_generation");--> statement-breakpoint
CREATE INDEX "docker_image_security_scans_image_identifier_generation_idx" ON "docker_image_security_scans" USING btree ("image_identifier_normalized","image_generation");