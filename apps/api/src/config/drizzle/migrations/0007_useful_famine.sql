CREATE TYPE "public"."alert_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."alert_type" AS ENUM('cpu', 'memory', 'storage', 'network', 'disk', 'health');--> statement-breakpoint
CREATE TYPE "public"."cache_strategy" AS ENUM('strict', 'loose');--> statement-breakpoint
CREATE TYPE "public"."deployment_environment" AS ENUM('production', 'staging', 'preview', 'development');--> statement-breakpoint
CREATE TYPE "public"."deployment_phase" AS ENUM('queued', 'pulling_source', 'building', 'copying_files', 'creating_symlinks', 'updating_routes', 'health_check', 'active', 'failed');--> statement-breakpoint
CREATE TYPE "public"."deployment_rule_trigger" AS ENUM('push', 'pull_request', 'tag', 'release', 'manual');--> statement-breakpoint
CREATE TYPE "public"."deployment_status" AS ENUM('pending', 'queued', 'building', 'deploying', 'success', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."deployment_strategy" AS ENUM('standard', 'blue-green', 'canary', 'rolling', 'custom');--> statement-breakpoint
CREATE TYPE "public"."environment_status" AS ENUM('healthy', 'updating', 'error', 'pending', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."environment_type" AS ENUM('production', 'staging', 'preview', 'development');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('deploy', 'update', 'remove', 'scale', 'build', 'cleanup', 'health-check', 'ssl-renew', 'backup', 'restore');--> statement-breakpoint
CREATE TYPE "public"."log_level" AS ENUM('info', 'warn', 'error', 'debug');--> statement-breakpoint
CREATE TYPE "public"."network_type" AS ENUM('bridge', 'overlay', 'host', 'none');--> statement-breakpoint
CREATE TYPE "public"."orchestration_type" AS ENUM('compose', 'swarm', 'kubernetes');--> statement-breakpoint
CREATE TYPE "public"."preview_deployment_status" AS ENUM('pending', 'building', 'deploying', 'active', 'failed', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."project_role" AS ENUM('owner', 'admin', 'developer', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."rollback_status" AS ENUM('pending', 'in_progress', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."service_health" AS ENUM('unknown', 'healthy', 'unhealthy', 'starting', 'removing');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('github', 'gitlab', 'git', 'upload', 'custom');--> statement-breakpoint
CREATE TYPE "public"."ssl_provider" AS ENUM('letsencrypt', 'custom', 'none');--> statement-breakpoint
CREATE TYPE "public"."stack_status" AS ENUM('creating', 'running', 'updating', 'removing', 'failed', 'paused');--> statement-breakpoint
CREATE TYPE "public"."variable_resolution_status" AS ENUM('pending', 'resolved', 'failed');--> statement-breakpoint
CREATE TYPE "public"."verification_method" AS ENUM('txt_record', 'cname_record');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('pending', 'verified', 'failed');--> statement-breakpoint
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
CREATE TABLE "config_files" (
	"id" text PRIMARY KEY NOT NULL,
	"traefik_config_id" text NOT NULL,
	"file_path" text NOT NULL,
	"file_size" integer,
	"checksum" text,
	"permissions" text DEFAULT '644',
	"owner" text DEFAULT 'traefik',
	"exists" boolean DEFAULT false,
	"is_writable" boolean DEFAULT true,
	"last_write_attempt" timestamp,
	"write_error_message" text,
	"container_path" text,
	"mount_point" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "deployment_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deployment_id" uuid NOT NULL,
	"job_type" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"job_data" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"estimated_duration" integer,
	"result" jsonb,
	"bull_job_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deployment_id" uuid NOT NULL,
	"level" "log_level" DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"phase" text,
	"step" text,
	"service" text,
	"stage" text,
	"metadata" jsonb,
	"timestamp" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_rollbacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_deployment_id" uuid NOT NULL,
	"to_deployment_id" uuid NOT NULL,
	"triggered_by" text,
	"status" "rollback_status" DEFAULT 'pending' NOT NULL,
	"reason" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"failed_at" timestamp,
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger" "deployment_rule_trigger" NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"branch_pattern" text,
	"exclude_branch_pattern" text,
	"tag_pattern" text,
	"pr_labels" jsonb,
	"pr_target_branches" jsonb,
	"require_approval" boolean DEFAULT false,
	"min_approvals" integer DEFAULT 1,
	"environment" "deployment_environment" NOT NULL,
	"auto_merge_on_success" boolean DEFAULT false,
	"auto_delete_on_merge" boolean DEFAULT true,
	"environment_variables" jsonb,
	"builder_config_override" jsonb,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
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
	"domain_url" text,
	"health_check_url" text,
	"error_message" text,
	"phase" "deployment_phase" DEFAULT 'queued',
	"phase_progress" integer DEFAULT 0,
	"phase_metadata" jsonb,
	"phase_updated_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"subdomain" text,
	"full_domain" text NOT NULL,
	"ssl_enabled" boolean DEFAULT false,
	"ssl_provider" text,
	"certificate_path" text,
	"middleware" jsonb,
	"dns_status" text DEFAULT 'pending',
	"dns_records" jsonb,
	"dns_last_checked" timestamp,
	"dns_error_message" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environment_access_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment_id" uuid NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"metadata" jsonb,
	"timestamp" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environment_promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_environment_id" uuid NOT NULL,
	"target_environment_id" uuid NOT NULL,
	"service_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"promoted_by" text NOT NULL,
	"source_deployment_id" uuid,
	"target_deployment_id" uuid,
	"metadata" jsonb,
	"started_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environment_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"service_config" jsonb,
	"is_deployed" boolean DEFAULT false NOT NULL,
	"last_deployment_id" uuid,
	"deployment_status" text DEFAULT 'pending',
	"health_status" text DEFAULT 'unknown',
	"last_health_check" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environment_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" "environment_type" NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"default_variables" jsonb DEFAULT '[]'::jsonb,
	"variable_definitions" jsonb DEFAULT '[]'::jsonb,
	"deployment_settings" jsonb,
	"security_settings" jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environment_variables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"is_secret" boolean DEFAULT false NOT NULL,
	"description" text,
	"category" text,
	"is_dynamic" boolean DEFAULT false NOT NULL,
	"template" text,
	"resolution_status" "variable_resolution_status" DEFAULT 'resolved',
	"resolved_value" text,
	"resolution_error" text,
	"last_resolved" timestamp,
	"references" jsonb DEFAULT '[]'::jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"type" "environment_type" NOT NULL,
	"status" "environment_status" DEFAULT 'pending' NOT NULL,
	"template_id" uuid,
	"project_id" uuid,
	"domain_config" jsonb,
	"network_config" jsonb,
	"deployment_config" jsonb,
	"resource_limits" jsonb,
	"preview_settings" jsonb,
	"metadata" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
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
CREATE TABLE "github_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"installation_id" integer NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"account_avatar_url" text,
	"repositories_count" integer DEFAULT 0,
	"app_id" text,
	"private_key" text,
	"client_id" text,
	"client_secret" text,
	"webhook_secret" text,
	"permissions" jsonb,
	"access_token_url" text,
	"html_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "github_installations_installation_id_unique" UNIQUE("installation_id")
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
CREATE TABLE "github_repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" uuid NOT NULL,
	"repository_id" integer NOT NULL,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"private" boolean NOT NULL,
	"html_url" text NOT NULL,
	"description" text,
	"default_branch" text NOT NULL,
	"language" text,
	"forks_count" integer DEFAULT 0,
	"stargazers_count" integer DEFAULT 0,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "github_repositories_repository_id_unique" UNIQUE("repository_id")
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
CREATE TABLE "health_check_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"cron_expression" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"batch_size" integer DEFAULT 10 NOT NULL,
	"timeout" integer DEFAULT 300 NOT NULL,
	"last_run" timestamp with time zone,
	"next_run" timestamp with time zone,
	"run_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_check_jobs_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "health_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"status" text NOT NULL,
	"message" text NOT NULL,
	"details" jsonb,
	"response_time" integer,
	"check_type" text NOT NULL,
	"check_config" jsonb NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_aggregates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stack_id" uuid,
	"aggregation_type" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"avg_cpu_usage" numeric(5, 2),
	"max_cpu_usage" numeric(5, 2),
	"min_cpu_usage" numeric(5, 2),
	"avg_memory_usage" numeric(12, 0),
	"max_memory_usage" numeric(12, 0),
	"min_memory_usage" numeric(12, 0),
	"avg_storage_usage" numeric(12, 0),
	"max_storage_usage" numeric(12, 0),
	"min_storage_usage" numeric(12, 0),
	"total_network_rx" numeric(12, 0),
	"total_network_tx" numeric(12, 0),
	"total_disk_read" numeric(12, 0),
	"total_disk_write" numeric(12, 0),
	"data_points" integer NOT NULL,
	"alert_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"network_name" text NOT NULL,
	"network_id" text NOT NULL,
	"network_type" "network_type" DEFAULT 'overlay' NOT NULL,
	"environment" text NOT NULL,
	"network_config" jsonb,
	"domain_assignments" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orchestration_stacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"project_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"orchestration_type" "orchestration_type" DEFAULT 'swarm' NOT NULL,
	"compose_config" jsonb NOT NULL,
	"resource_quotas" jsonb,
	"domain_mappings" jsonb,
	"status" "stack_status" DEFAULT 'creating' NOT NULL,
	"last_deployed_at" timestamp,
	"last_health_check" timestamp,
	"error_message" text,
	"current_resources" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "orchestration_stacks_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "organization_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"domain" varchar(255) NOT NULL,
	"verification_status" "verification_status" DEFAULT 'pending' NOT NULL,
	"verification_method" "verification_method" DEFAULT 'txt_record' NOT NULL,
	"verification_token" varchar(255) NOT NULL,
	"dns_record_checked" boolean DEFAULT false NOT NULL,
	"last_verification_attempt" timestamp,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb
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
CREATE TABLE "project_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"organization_domain_id" uuid NOT NULL,
	"allowed_subdomains" varchar(100)[] DEFAULT '{}' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base_domain" text,
	"owner_id" text NOT NULL,
	"settings" jsonb,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_traefik_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_type" text NOT NULL,
	"template_name" text NOT NULL,
	"template_content" text NOT NULL,
	"description" text,
	"variables" jsonb,
	"is_default" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "provider_traefik_templates_provider_type_unique" UNIQUE("provider_type")
);
--> statement-breakpoint
CREATE TABLE "resource_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stack_id" uuid NOT NULL,
	"service_id" uuid,
	"alert_type" "alert_type" NOT NULL,
	"severity" "alert_severity" NOT NULL,
	"message" text NOT NULL,
	"threshold" numeric(10, 2) NOT NULL,
	"current_value" numeric(10, 2) NOT NULL,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"cpu_limit" text,
	"memory_limit" text,
	"storage_limit" text,
	"current_usage" jsonb,
	"quotas" jsonb,
	"last_updated" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_config_id" text NOT NULL,
	"deployment_id" uuid,
	"route_name" text NOT NULL,
	"service_name" text NOT NULL,
	"container_name" text,
	"target_port" integer NOT NULL,
	"path_prefix" text,
	"priority" integer DEFAULT 1,
	"middleware" jsonb,
	"health_check" jsonb,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_config_references" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" uuid NOT NULL,
	"traefik_config_id" text NOT NULL,
	"reference_type" text NOT NULL,
	"priority" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
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
CREATE TABLE "service_domain_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"project_domain_id" uuid NOT NULL,
	"subdomain" varchar(63),
	"base_path" varchar(255),
	"is_primary" boolean DEFAULT false NOT NULL,
	"ssl_enabled" boolean DEFAULT true NOT NULL,
	"ssl_provider" "ssl_provider" DEFAULT 'letsencrypt' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "service_health_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"check_type" text DEFAULT 'http' NOT NULL,
	"interval" integer DEFAULT 60 NOT NULL,
	"timeout" integer DEFAULT 30 NOT NULL,
	"retries" integer DEFAULT 3 NOT NULL,
	"start_period" integer DEFAULT 60 NOT NULL,
	"config" jsonb NOT NULL,
	"alert_on_failure" boolean DEFAULT true NOT NULL,
	"alert_webhook_url" text,
	"alert_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_health_configs_service_id_unique" UNIQUE("service_id")
);
--> statement-breakpoint
CREATE TABLE "service_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stack_id" uuid NOT NULL,
	"service_id" uuid,
	"service_name" text NOT NULL,
	"image" text NOT NULL,
	"tag" text DEFAULT 'latest' NOT NULL,
	"desired_replicas" integer DEFAULT 1 NOT NULL,
	"current_replicas" integer DEFAULT 0 NOT NULL,
	"resource_limits" jsonb,
	"health_status" "service_health" DEFAULT 'unknown' NOT NULL,
	"health_check_config" jsonb,
	"last_health_check" timestamp,
	"domain_assignments" jsonb,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_traefik_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" uuid NOT NULL,
	"template_content" text NOT NULL,
	"variables" jsonb,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"provider_id" text NOT NULL,
	"provider_config" jsonb,
	"builder_id" text NOT NULL,
	"builder_config" jsonb,
	"port" integer,
	"environment_variables" jsonb,
	"resource_limits" jsonb,
	"health_check_path" text DEFAULT '/health',
	"health_check_interval" integer DEFAULT 30,
	"health_check_timeout" integer DEFAULT 10,
	"health_check_retries" integer DEFAULT 3,
	"deployment_retention" jsonb DEFAULT '{"maxSuccessfulDeployments":5,"keepArtifacts":true,"autoCleanup":true}'::jsonb,
	"traefik_config" jsonb,
	"custom_domains" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ssl_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"project_id" uuid,
	"certificate_path" text,
	"private_key_path" text,
	"issuer" text DEFAULT 'letsencrypt' NOT NULL,
	"issued_at" timestamp,
	"expires_at" timestamp,
	"is_valid" boolean DEFAULT true NOT NULL,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"last_renewal_attempt" timestamp,
	"renewal_status" text,
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "ssl_certificates_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "stack_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stack_id" uuid NOT NULL,
	"service_id" uuid,
	"cpu_usage" numeric(5, 2),
	"memory_usage" numeric(12, 0),
	"memory_limit" numeric(12, 0),
	"storage_usage" numeric(12, 0),
	"network_rx" numeric(12, 0),
	"network_tx" numeric(12, 0),
	"disk_read" numeric(12, 0),
	"disk_write" numeric(12, 0),
	"metadata" jsonb,
	"timestamp" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cpu_usage" numeric(5, 2),
	"memory_usage" numeric(10, 0),
	"memory_total" numeric(10, 0),
	"storage_usage" numeric(10, 0),
	"storage_total" numeric(10, 0),
	"total_containers" integer DEFAULT 0 NOT NULL,
	"running_containers" integer DEFAULT 0 NOT NULL,
	"total_stacks" integer DEFAULT 0 NOT NULL,
	"total_networks" integer DEFAULT 0 NOT NULL,
	"total_volumes" integer DEFAULT 0 NOT NULL,
	"active_deployments" integer DEFAULT 0 NOT NULL,
	"total_projects" integer DEFAULT 0 NOT NULL,
	"total_users" integer DEFAULT 0 NOT NULL,
	"network_traffic" jsonb,
	"timestamp" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traefik_backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"backup_name" text NOT NULL,
	"backup_type" text NOT NULL,
	"original_path" text NOT NULL,
	"backup_content" text NOT NULL,
	"compression_type" text,
	"backup_size" integer,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "traefik_config_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"relative_path" text NOT NULL,
	"file_type" text DEFAULT 'config',
	"content_type" text,
	"size" integer,
	"checksum" text,
	"content" text,
	"last_synced" timestamp,
	"sync_status" text DEFAULT 'pending',
	"sync_error" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "traefik_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"config_name" text NOT NULL,
	"config_content" text NOT NULL,
	"config_type" text NOT NULL,
	"storage_type" text DEFAULT 'project' NOT NULL,
	"project_id" uuid,
	"requires_file" boolean DEFAULT true,
	"sync_status" text DEFAULT 'pending',
	"last_synced_at" timestamp,
	"sync_error_message" text,
	"file_checksum" text,
	"config_version" integer DEFAULT 1,
	"metadata" jsonb,
	"description" text,
	"tags" jsonb,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traefik_domain_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_id" uuid NOT NULL,
	"host_rule" text NOT NULL,
	"path_rule" text,
	"method" text,
	"headers" json,
	"priority" integer DEFAULT 1,
	"entry_point" text DEFAULT 'web',
	"middleware" json,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "traefik_middleware" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"middleware_name" text NOT NULL,
	"middleware_type" text NOT NULL,
	"configuration" jsonb NOT NULL,
	"is_global" boolean DEFAULT false,
	"priority" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"file_path" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traefik_middlewares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"config" json NOT NULL,
	"description" text,
	"is_global" boolean DEFAULT false,
	"service_id" uuid,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "traefik_plugins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"plugin_name" text NOT NULL,
	"plugin_version" text NOT NULL,
	"plugin_source" text NOT NULL,
	"configuration" jsonb,
	"is_enabled" boolean DEFAULT true,
	"file_path" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traefik_ssl_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"subject_alt_names" json,
	"issuer" text,
	"serial_number" text,
	"fingerprint" text,
	"not_before" timestamp,
	"not_after" timestamp,
	"certificate_data" text,
	"private_key_data" text,
	"auto_renew" boolean DEFAULT true,
	"renewal_threshold" integer DEFAULT 30,
	"last_renewal" timestamp,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "traefik_service_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"subdomain" text,
	"full_domain" text NOT NULL,
	"ssl_enabled" boolean DEFAULT false,
	"ssl_provider" text,
	"path_prefix" text,
	"port" integer NOT NULL,
	"middleware" json,
	"health_check" json,
	"is_active" boolean DEFAULT true,
	"config_content" text,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "traefik_service_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_id" uuid NOT NULL,
	"url" text NOT NULL,
	"weight" integer DEFAULT 1,
	"health_check" json,
	"is_active" boolean DEFAULT true,
	"last_health_check" timestamp,
	"health_status" text DEFAULT 'unknown',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "traefik_static_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"global_config" jsonb,
	"api_config" jsonb,
	"entry_points_config" jsonb,
	"providers_config" jsonb,
	"log_config" jsonb,
	"access_log_config" jsonb,
	"metrics_config" jsonb,
	"tracing_config" jsonb,
	"tls_config" jsonb,
	"certificate_resolvers_config" jsonb,
	"experimental_config" jsonb,
	"servers_transport_config" jsonb,
	"host_resolver_config" jsonb,
	"cluster_config" jsonb,
	"full_config" jsonb,
	"config_version" integer DEFAULT 1,
	"sync_status" text DEFAULT 'pending',
	"last_synced_at" timestamp,
	"sync_error_message" text,
	"is_valid" boolean DEFAULT true,
	"validation_errors" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "traefik_static_configs_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "traefik_static_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"file_name" text NOT NULL,
	"file_content" text NOT NULL,
	"mime_type" text DEFAULT 'text/plain',
	"file_size" integer,
	"relative_path" text NOT NULL,
	"is_public" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variable_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"variables" jsonb DEFAULT '[]'::jsonb,
	"is_system" boolean DEFAULT false NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"last_used" timestamp,
	"created_by" text NOT NULL,
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
ALTER TABLE "account" ALTER COLUMN "created_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "created_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "created_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "updated_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "created_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "updated_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "active_organization_id" text;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_files" ADD CONSTRAINT "config_files_traefik_config_id_traefik_configs_id_fk" FOREIGN KEY ("traefik_config_id") REFERENCES "public"."traefik_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_cache" ADD CONSTRAINT "deployment_cache_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_jobs" ADD CONSTRAINT "deployment_jobs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_logs" ADD CONSTRAINT "deployment_logs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_rollbacks" ADD CONSTRAINT "deployment_rollbacks_from_deployment_id_deployments_id_fk" FOREIGN KEY ("from_deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_rollbacks" ADD CONSTRAINT "deployment_rollbacks_to_deployment_id_deployments_id_fk" FOREIGN KEY ("to_deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_rollbacks" ADD CONSTRAINT "deployment_rollbacks_triggered_by_user_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_rules" ADD CONSTRAINT "deployment_rules_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_triggered_by_user_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_configs" ADD CONSTRAINT "domain_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_access_logs" ADD CONSTRAINT "environment_access_logs_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_access_logs" ADD CONSTRAINT "environment_access_logs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_promotions" ADD CONSTRAINT "environment_promotions_source_environment_id_environments_id_fk" FOREIGN KEY ("source_environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_promotions" ADD CONSTRAINT "environment_promotions_target_environment_id_environments_id_fk" FOREIGN KEY ("target_environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_promotions" ADD CONSTRAINT "environment_promotions_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_promotions" ADD CONSTRAINT "environment_promotions_promoted_by_user_id_fk" FOREIGN KEY ("promoted_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_services" ADD CONSTRAINT "environment_services_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_services" ADD CONSTRAINT "environment_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_templates" ADD CONSTRAINT "environment_templates_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_variables" ADD CONSTRAINT "environment_variables_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_variables" ADD CONSTRAINT "environment_variables_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_template_id_environment_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."environment_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_deployment_rules" ADD CONSTRAINT "github_deployment_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_preview_deployments" ADD CONSTRAINT "github_preview_deployments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_repositories" ADD CONSTRAINT "github_repositories_installation_id_github_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."github_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_repository_configs" ADD CONSTRAINT "github_repository_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_repository_configs" ADD CONSTRAINT "github_repository_configs_github_app_id_github_apps_id_fk" FOREIGN KEY ("github_app_id") REFERENCES "public"."github_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_webhook_events" ADD CONSTRAINT "github_webhook_events_github_app_id_github_apps_id_fk" FOREIGN KEY ("github_app_id") REFERENCES "public"."github_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_checks" ADD CONSTRAINT "health_checks_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_tracking" ADD CONSTRAINT "job_tracking_stack_id_orchestration_stacks_id_fk" FOREIGN KEY ("stack_id") REFERENCES "public"."orchestration_stacks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_tracking" ADD CONSTRAINT "job_tracking_service_id_service_instances_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_aggregates" ADD CONSTRAINT "metric_aggregates_stack_id_orchestration_stacks_id_fk" FOREIGN KEY ("stack_id") REFERENCES "public"."orchestration_stacks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_assignments" ADD CONSTRAINT "network_assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestration_stacks" ADD CONSTRAINT "orchestration_stacks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_domains" ADD CONSTRAINT "organization_domains_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_environments" ADD CONSTRAINT "preview_environments_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_collaborators" ADD CONSTRAINT "project_collaborators_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_collaborators" ADD CONSTRAINT "project_collaborators_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_collaborators" ADD CONSTRAINT "project_collaborators_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_domains" ADD CONSTRAINT "project_domains_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_domains" ADD CONSTRAINT "project_domains_organization_domain_id_organization_domains_id_fk" FOREIGN KEY ("organization_domain_id") REFERENCES "public"."organization_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_alerts" ADD CONSTRAINT "resource_alerts_stack_id_orchestration_stacks_id_fk" FOREIGN KEY ("stack_id") REFERENCES "public"."orchestration_stacks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_alerts" ADD CONSTRAINT "resource_alerts_service_id_service_instances_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_allocations" ADD CONSTRAINT "resource_allocations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_configs" ADD CONSTRAINT "route_configs_domain_config_id_domain_configs_id_fk" FOREIGN KEY ("domain_config_id") REFERENCES "public"."domain_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_configs" ADD CONSTRAINT "route_configs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_config_references" ADD CONSTRAINT "service_config_references_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_config_references" ADD CONSTRAINT "service_config_references_traefik_config_id_traefik_configs_id_fk" FOREIGN KEY ("traefik_config_id") REFERENCES "public"."traefik_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_dependencies" ADD CONSTRAINT "service_dependencies_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_dependencies" ADD CONSTRAINT "service_dependencies_depends_on_service_id_services_id_fk" FOREIGN KEY ("depends_on_service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_domain_mappings" ADD CONSTRAINT "service_domain_mappings_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_domain_mappings" ADD CONSTRAINT "service_domain_mappings_project_domain_id_project_domains_id_fk" FOREIGN KEY ("project_domain_id") REFERENCES "public"."project_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_health_configs" ADD CONSTRAINT "service_health_configs_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_instances" ADD CONSTRAINT "service_instances_stack_id_orchestration_stacks_id_fk" FOREIGN KEY ("stack_id") REFERENCES "public"."orchestration_stacks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_instances" ADD CONSTRAINT "service_instances_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_traefik_templates" ADD CONSTRAINT "service_traefik_templates_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssl_certificates" ADD CONSTRAINT "ssl_certificates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stack_metrics" ADD CONSTRAINT "stack_metrics_stack_id_orchestration_stacks_id_fk" FOREIGN KEY ("stack_id") REFERENCES "public"."orchestration_stacks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stack_metrics" ADD CONSTRAINT "stack_metrics_service_id_service_instances_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traefik_backups" ADD CONSTRAINT "traefik_backups_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traefik_config_files" ADD CONSTRAINT "traefik_config_files_config_id_traefik_service_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."traefik_service_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traefik_configs" ADD CONSTRAINT "traefik_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traefik_domain_routes" ADD CONSTRAINT "traefik_domain_routes_config_id_traefik_service_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."traefik_service_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traefik_middleware" ADD CONSTRAINT "traefik_middleware_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traefik_middlewares" ADD CONSTRAINT "traefik_middlewares_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traefik_plugins" ADD CONSTRAINT "traefik_plugins_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traefik_ssl_certificates" ADD CONSTRAINT "traefik_ssl_certificates_config_id_traefik_service_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."traefik_service_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traefik_service_configs" ADD CONSTRAINT "traefik_service_configs_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traefik_service_targets" ADD CONSTRAINT "traefik_service_targets_config_id_traefik_service_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."traefik_service_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traefik_static_configs" ADD CONSTRAINT "traefik_static_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traefik_static_files" ADD CONSTRAINT "traefik_static_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variable_templates" ADD CONSTRAINT "variable_templates_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
CREATE INDEX "github_webhook_events_processed_idx" ON "github_webhook_events" USING btree ("processed");--> statement-breakpoint
CREATE INDEX "health_checks_service_id_idx" ON "health_checks" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "health_checks_checked_at_idx" ON "health_checks" USING btree ("checked_at");--> statement-breakpoint
CREATE INDEX "health_checks_status_idx" ON "health_checks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "service_health_configs_service_id_idx" ON "service_health_configs" USING btree ("service_id");