CREATE TYPE "public"."deployment_environment" AS ENUM('production', 'staging', 'preview', 'development');--> statement-breakpoint
CREATE TYPE "public"."deployment_status" AS ENUM('pending', 'queued', 'building', 'deploying', 'success', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."log_level" AS ENUM('info', 'warn', 'error', 'debug');--> statement-breakpoint
CREATE TYPE "public"."project_role" AS ENUM('owner', 'admin', 'developer', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('github', 'gitlab', 'git', 'upload', 'custom');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_preview" text NOT NULL,
	"scopes" jsonb,
	"last_used" timestamp,
	"expires_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "deployment_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deployment_id" uuid NOT NULL,
	"level" "log_level" DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"phase" text,
	"step" text,
	"metadata" jsonb,
	"timestamp" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"triggered_by" text,
	"status" "deployment_status" DEFAULT 'pending' NOT NULL,
	"environment" "deployment_environment" DEFAULT 'production' NOT NULL,
	"source_type" "source_type" NOT NULL,
	"source_config" jsonb,
	"build_started_at" timestamp,
	"build_completed_at" timestamp,
	"deploy_started_at" timestamp,
	"deploy_completed_at" timestamp,
	"container_name" text,
	"container_image" text,
	"health_check_url" text,
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preview_environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deployment_id" uuid NOT NULL,
	"subdomain" text NOT NULL,
	"full_domain" text NOT NULL,
	"ssl_enabled" boolean DEFAULT true NOT NULL,
	"ssl_certificate_path" text,
	"expires_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"webhook_triggered" boolean DEFAULT false NOT NULL,
	"environment_variables" jsonb,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "preview_environments_subdomain_unique" UNIQUE("subdomain")
);
--> statement-breakpoint
CREATE TABLE "project_collaborators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "project_role" DEFAULT 'developer' NOT NULL,
	"permissions" jsonb,
	"invited_by" text,
	"invited_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base_domain" text,
	"owner_id" text NOT NULL,
	"settings" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"depends_on_service_id" uuid NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"dockerfile_path" text DEFAULT 'Dockerfile',
	"build_context" text DEFAULT '.',
	"port" integer,
	"health_check_path" text DEFAULT '/health',
	"environment_variables" jsonb,
	"build_arguments" jsonb,
	"resource_limits" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"service_id" uuid,
	"source_type" "source_type" NOT NULL,
	"webhook_url" text NOT NULL,
	"external_webhook_id" text,
	"secret" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_triggered" timestamp,
	"trigger_count" integer DEFAULT 0 NOT NULL,
	"settings" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_logs" ADD CONSTRAINT "deployment_logs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_triggered_by_user_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_environments" ADD CONSTRAINT "preview_environments_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_collaborators" ADD CONSTRAINT "project_collaborators_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_collaborators" ADD CONSTRAINT "project_collaborators_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_collaborators" ADD CONSTRAINT "project_collaborators_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_dependencies" ADD CONSTRAINT "service_dependencies_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_dependencies" ADD CONSTRAINT "service_dependencies_depends_on_service_id_services_id_fk" FOREIGN KEY ("depends_on_service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;