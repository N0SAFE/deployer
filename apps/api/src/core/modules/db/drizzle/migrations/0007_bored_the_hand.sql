CREATE TYPE "public"."service_builder" AS ENUM('nixpack', 'railpack', 'dockerfile', 'buildpack', 'static', 'docker_compose');--> statement-breakpoint
CREATE TYPE "public"."service_provider" AS ENUM('github', 'gitlab', 'bitbucket', 'docker_registry', 'gitea', 's3_bucket', 'manual');--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "provider" "service_provider" NOT NULL DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "builder" "service_builder" NOT NULL DEFAULT 'dockerfile';--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "provider_config" jsonb;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "builder_config" jsonb;--> statement-breakpoint
ALTER TABLE "services" DROP COLUMN "dockerfile_path";--> statement-breakpoint
ALTER TABLE "services" DROP COLUMN "build_context";--> statement-breakpoint
ALTER TABLE "services" DROP COLUMN "build_arguments";