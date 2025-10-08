ALTER TABLE "services" RENAME COLUMN "provider" TO "provider_id";--> statement-breakpoint
ALTER TABLE "services" RENAME COLUMN "builder" TO "builder_id";--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "health_check_interval" integer DEFAULT 30;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "health_check_timeout" integer DEFAULT 10;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "health_check_retries" integer DEFAULT 3;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "custom_domains" jsonb;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "metadata" jsonb;