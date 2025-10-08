CREATE TYPE "public"."cache_strategy" AS ENUM('strict', 'loose');--> statement-breakpoint
CREATE TYPE "public"."deployment_strategy" AS ENUM('standard', 'blue-green', 'canary', 'rolling', 'custom');--> statement-breakpoint
CREATE TYPE "public"."preview_deployment_status" AS ENUM('pending', 'building', 'deploying', 'active', 'failed', 'deleted');--> statement-breakpoint
CREATE TABLE "deployment_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"branch" text NOT NULL,
	"commit_sha" text NOT NULL,
	"commit_message" text,
	"commit_author" text,
	"commit_date" timestamp with time zone,
	"changed_files" jsonb NOT NULL,
	"deployment_id" uuid,
	"base_path" text DEFAULT '/',
	"cache_strategy" "cache_strategy" DEFAULT 'strict' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"app_id" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"private_key" text NOT NULL,
	"webhook_secret" text NOT NULL,
	"installation_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_deployment_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"event" text NOT NULL,
	"branch_pattern" text,
	"tag_pattern" text,
	"path_conditions" jsonb,
	"custom_condition" text,
	"action" text NOT NULL,
	"deployment_strategy" "deployment_strategy",
	"custom_strategy_script" text,
	"bypass_cache" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_preview_deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"pr_number" integer NOT NULL,
	"branch" text NOT NULL,
	"deployment_id" uuid,
	"service_name" text NOT NULL,
	"url" text,
	"status" "preview_deployment_status" DEFAULT 'pending' NOT NULL,
	"last_activity_at" timestamp with time zone NOT NULL,
	"auto_delete_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_repository_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"github_app_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"repository_full_name" text NOT NULL,
	"base_path" text DEFAULT '/',
	"watch_paths" jsonb DEFAULT '[]'::jsonb,
	"ignore_paths" jsonb DEFAULT '[]'::jsonb,
	"cache_strategy" "cache_strategy" DEFAULT 'strict' NOT NULL,
	"auto_deploy_enabled" boolean DEFAULT true NOT NULL,
	"deployment_strategy" "deployment_strategy" DEFAULT 'standard' NOT NULL,
	"custom_strategy_script" text,
	"preview_deployments_enabled" boolean DEFAULT false NOT NULL,
	"preview_branch_pattern" text DEFAULT '*',
	"preview_auto_delete" boolean DEFAULT true NOT NULL,
	"preview_auto_delete_after_days" integer DEFAULT 7,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_app_id" uuid NOT NULL,
	"event" text NOT NULL,
	"delivery_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deployment_cache" ADD CONSTRAINT "deployment_cache_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_deployment_rules" ADD CONSTRAINT "github_deployment_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_preview_deployments" ADD CONSTRAINT "github_preview_deployments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_repository_configs" ADD CONSTRAINT "github_repository_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_repository_configs" ADD CONSTRAINT "github_repository_configs_github_app_id_github_apps_id_fk" FOREIGN KEY ("github_app_id") REFERENCES "public"."github_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_webhook_events" ADD CONSTRAINT "github_webhook_events_github_app_id_github_apps_id_fk" FOREIGN KEY ("github_app_id") REFERENCES "public"."github_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deployment_cache_project_id_idx" ON "deployment_cache" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "deployment_cache_repo_id_idx" ON "deployment_cache" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "deployment_cache_branch_idx" ON "deployment_cache" USING btree ("branch");--> statement-breakpoint
CREATE INDEX "deployment_cache_commit_sha_idx" ON "deployment_cache" USING btree ("commit_sha");--> statement-breakpoint
CREATE INDEX "github_apps_org_id_idx" ON "github_apps" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "github_apps_app_id_idx" ON "github_apps" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "github_deployment_rules_project_id_idx" ON "github_deployment_rules" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "github_deployment_rules_priority_idx" ON "github_deployment_rules" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "github_preview_deployments_project_id_idx" ON "github_preview_deployments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "github_preview_deployments_repo_id_idx" ON "github_preview_deployments" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "github_preview_deployments_pr_number_idx" ON "github_preview_deployments" USING btree ("pr_number");--> statement-breakpoint
CREATE INDEX "github_preview_deployments_status_idx" ON "github_preview_deployments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "github_repo_configs_project_id_idx" ON "github_repository_configs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "github_repo_configs_github_app_id_idx" ON "github_repository_configs" USING btree ("github_app_id");--> statement-breakpoint
CREATE INDEX "github_repo_configs_repo_id_idx" ON "github_repository_configs" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "github_webhook_events_app_id_idx" ON "github_webhook_events" USING btree ("github_app_id");--> statement-breakpoint
CREATE INDEX "github_webhook_events_delivery_id_idx" ON "github_webhook_events" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "github_webhook_events_processed_idx" ON "github_webhook_events" USING btree ("processed");