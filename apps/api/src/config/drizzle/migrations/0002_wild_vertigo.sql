CREATE TYPE "public"."deployment_environment" AS ENUM('production', 'staging', 'preview', 'development');--> statement-breakpoint
CREATE TYPE "public"."deployment_status" AS ENUM('pending', 'queued', 'building', 'deploying', 'success', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."log_level" AS ENUM('info', 'warn', 'error', 'debug');--> statement-breakpoint
CREATE TYPE "public"."project_role" AS ENUM('owner', 'admin', 'developer', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."service_builder" AS ENUM('nixpack', 'railpack', 'dockerfile', 'buildpack', 'static', 'docker_compose');--> statement-breakpoint
CREATE TYPE "public"."service_provider" AS ENUM('github', 'gitlab', 'bitbucket', 'docker_registry', 'gitea', 's3_bucket', 'manual');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('github', 'gitlab', 'git', 'upload', 'custom');--> statement-breakpoint
CREATE TYPE "public"."environment_status" AS ENUM('healthy', 'updating', 'error', 'pending', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."environment_type" AS ENUM('production', 'staging', 'preview', 'development');--> statement-breakpoint
CREATE TYPE "public"."variable_resolution_status" AS ENUM('pending', 'resolved', 'failed');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('deploy', 'update', 'remove', 'scale', 'build', 'cleanup', 'health-check', 'ssl-renew', 'backup', 'restore');--> statement-breakpoint
CREATE TYPE "public"."network_type" AS ENUM('bridge', 'overlay', 'host', 'none');--> statement-breakpoint
CREATE TYPE "public"."orchestration_type" AS ENUM('compose', 'swarm', 'kubernetes');--> statement-breakpoint
CREATE TYPE "public"."service_health" AS ENUM('unknown', 'healthy', 'unhealthy', 'starting', 'removing');--> statement-breakpoint
CREATE TYPE "public"."stack_status" AS ENUM('creating', 'running', 'updating', 'removing', 'failed', 'paused');--> statement-breakpoint
CREATE TYPE "public"."alert_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."alert_type" AS ENUM('cpu', 'memory', 'storage', 'network', 'disk', 'health');--> statement-breakpoint
CREATE TABLE "apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"key" text NOT NULL,
	"user_id" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer DEFAULT 86400000,
	"rate_limit_max" integer DEFAULT 10,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"last_request" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"team_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"inviter_id" text NOT NULL
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
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "team" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "team_member" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp
);
--> statement-breakpoint
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
	"service" text,
	"stage" text,
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
	"domain_url" text,
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
	"provider" "service_provider" NOT NULL,
	"builder" "service_builder" NOT NULL,
	"provider_config" jsonb,
	"builder_config" jsonb,
	"port" integer,
	"health_check_path" text DEFAULT '/health',
	"environment_variables" jsonb,
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
CREATE TABLE "traefik_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"config_name" text NOT NULL,
	"config_content" text NOT NULL,
	"config_type" text NOT NULL,
	"storage_type" text DEFAULT 'project' NOT NULL,
	"project_id" uuid,
	"config_path" text,
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
CREATE TABLE "system_status" (
	"id" varchar(50) PRIMARY KEY DEFAULT 'system' NOT NULL,
	"is_seeded" boolean DEFAULT false NOT NULL,
	"seed_version" varchar(20) DEFAULT '1.0.0',
	"last_seeded_at" timestamp,
	"seed_metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "passkey" RENAME COLUMN "credential_i_d" TO "credential_id";--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "email_verified" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "active_organization_id" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "active_team_id" text;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "variable_templates" ADD CONSTRAINT "variable_templates_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_files" ADD CONSTRAINT "config_files_traefik_config_id_traefik_configs_id_fk" FOREIGN KEY ("traefik_config_id") REFERENCES "public"."traefik_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_configs" ADD CONSTRAINT "domain_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_configs" ADD CONSTRAINT "route_configs_domain_config_id_domain_configs_id_fk" FOREIGN KEY ("domain_config_id") REFERENCES "public"."domain_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_configs" ADD CONSTRAINT "route_configs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_config_references" ADD CONSTRAINT "service_config_references_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_config_references" ADD CONSTRAINT "service_config_references_traefik_config_id_traefik_configs_id_fk" FOREIGN KEY ("traefik_config_id") REFERENCES "public"."traefik_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traefik_backups" ADD CONSTRAINT "traefik_backups_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traefik_configs" ADD CONSTRAINT "traefik_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traefik_middleware" ADD CONSTRAINT "traefik_middleware_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traefik_plugins" ADD CONSTRAINT "traefik_plugins_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traefik_ssl_certificates" ADD CONSTRAINT "traefik_ssl_certificates_config_id_traefik_service_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."traefik_service_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traefik_static_configs" ADD CONSTRAINT "traefik_static_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traefik_static_files" ADD CONSTRAINT "traefik_static_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traefik_config_files" ADD CONSTRAINT "traefik_config_files_config_id_traefik_service_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."traefik_service_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traefik_domain_routes" ADD CONSTRAINT "traefik_domain_routes_config_id_traefik_service_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."traefik_service_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traefik_middlewares" ADD CONSTRAINT "traefik_middlewares_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traefik_service_configs" ADD CONSTRAINT "traefik_service_configs_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traefik_service_targets" ADD CONSTRAINT "traefik_service_targets_config_id_traefik_service_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."traefik_service_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_jobs" ADD CONSTRAINT "deployment_jobs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_tracking" ADD CONSTRAINT "job_tracking_stack_id_orchestration_stacks_id_fk" FOREIGN KEY ("stack_id") REFERENCES "public"."orchestration_stacks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_tracking" ADD CONSTRAINT "job_tracking_service_id_service_instances_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_assignments" ADD CONSTRAINT "network_assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestration_stacks" ADD CONSTRAINT "orchestration_stacks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_allocations" ADD CONSTRAINT "resource_allocations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_instances" ADD CONSTRAINT "service_instances_stack_id_orchestration_stacks_id_fk" FOREIGN KEY ("stack_id") REFERENCES "public"."orchestration_stacks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_instances" ADD CONSTRAINT "service_instances_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssl_certificates" ADD CONSTRAINT "ssl_certificates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_aggregates" ADD CONSTRAINT "metric_aggregates_stack_id_orchestration_stacks_id_fk" FOREIGN KEY ("stack_id") REFERENCES "public"."orchestration_stacks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_alerts" ADD CONSTRAINT "resource_alerts_stack_id_orchestration_stacks_id_fk" FOREIGN KEY ("stack_id") REFERENCES "public"."orchestration_stacks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_alerts" ADD CONSTRAINT "resource_alerts_service_id_service_instances_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stack_metrics" ADD CONSTRAINT "stack_metrics_stack_id_orchestration_stacks_id_fk" FOREIGN KEY ("stack_id") REFERENCES "public"."orchestration_stacks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stack_metrics" ADD CONSTRAINT "stack_metrics_service_id_service_instances_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "health_checks_service_id_idx" ON "health_checks" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "health_checks_checked_at_idx" ON "health_checks" USING btree ("checked_at");--> statement-breakpoint
CREATE INDEX "health_checks_status_idx" ON "health_checks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "service_health_configs_service_id_idx" ON "service_health_configs" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "traefik_ssl_certificates_config_id_idx" ON "traefik_ssl_certificates" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "traefik_ssl_certificates_domain_idx" ON "traefik_ssl_certificates" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "traefik_ssl_certificates_expiry_idx" ON "traefik_ssl_certificates" USING btree ("not_after");--> statement-breakpoint
CREATE UNIQUE INDEX "traefik_ssl_certificates_domain_config_unique" ON "traefik_ssl_certificates" USING btree ("config_id","domain");--> statement-breakpoint
CREATE INDEX "traefik_config_files_config_id_idx" ON "traefik_config_files" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "traefik_config_files_file_path_idx" ON "traefik_config_files" USING btree ("file_path");--> statement-breakpoint
CREATE INDEX "traefik_config_files_file_type_idx" ON "traefik_config_files" USING btree ("file_type");--> statement-breakpoint
CREATE INDEX "traefik_config_files_sync_status_idx" ON "traefik_config_files" USING btree ("sync_status");--> statement-breakpoint
CREATE UNIQUE INDEX "traefik_config_files_config_file_unique" ON "traefik_config_files" USING btree ("config_id","file_path");--> statement-breakpoint
CREATE INDEX "traefik_domain_routes_config_id_idx" ON "traefik_domain_routes" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "traefik_domain_routes_host_rule_idx" ON "traefik_domain_routes" USING btree ("host_rule");--> statement-breakpoint
CREATE INDEX "traefik_domain_routes_priority_idx" ON "traefik_domain_routes" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "traefik_middlewares_name_idx" ON "traefik_middlewares" USING btree ("name");--> statement-breakpoint
CREATE INDEX "traefik_middlewares_type_idx" ON "traefik_middlewares" USING btree ("type");--> statement-breakpoint
CREATE INDEX "traefik_middlewares_service_id_idx" ON "traefik_middlewares" USING btree ("service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "traefik_middlewares_service_name_unique" ON "traefik_middlewares" USING btree ("service_id","name");--> statement-breakpoint
CREATE INDEX "traefik_service_configs_service_id_idx" ON "traefik_service_configs" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "traefik_service_configs_domain_idx" ON "traefik_service_configs" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "traefik_service_configs_full_domain_idx" ON "traefik_service_configs" USING btree ("full_domain");--> statement-breakpoint
CREATE UNIQUE INDEX "traefik_service_configs_service_id_unique" ON "traefik_service_configs" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "traefik_service_targets_config_id_idx" ON "traefik_service_targets" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "traefik_service_targets_url_idx" ON "traefik_service_targets" USING btree ("url");--> statement-breakpoint
CREATE INDEX "traefik_service_targets_health_status_idx" ON "traefik_service_targets" USING btree ("health_status");