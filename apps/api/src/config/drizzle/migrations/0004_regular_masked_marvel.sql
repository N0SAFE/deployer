CREATE TYPE "public"."deployment_phase" AS ENUM('queued', 'pulling_source', 'building', 'copying_files', 'creating_symlinks', 'updating_routes', 'health_check', 'active', 'failed');--> statement-breakpoint
DROP TABLE "apikey" CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_expires" timestamp;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "phase" text DEFAULT 'queued';--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "phase_progress" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "phase_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "phase_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "metadata" jsonb;