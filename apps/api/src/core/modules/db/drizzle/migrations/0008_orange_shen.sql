CREATE TYPE "public"."environment_status" AS ENUM('healthy', 'updating', 'error', 'pending', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."environment_type" AS ENUM('production', 'staging', 'preview', 'development');--> statement-breakpoint
CREATE TYPE "public"."variable_resolution_status" AS ENUM('pending', 'resolved', 'failed');--> statement-breakpoint
CREATE TYPE "public"."network_type" AS ENUM('bridge', 'overlay', 'host', 'none');--> statement-breakpoint
CREATE TYPE "public"."orchestration_type" AS ENUM('compose', 'swarm', 'kubernetes');--> statement-breakpoint
CREATE TYPE "public"."service_health" AS ENUM('unknown', 'healthy', 'unhealthy', 'starting', 'removing');--> statement-breakpoint
CREATE TYPE "public"."stack_status" AS ENUM('creating', 'running', 'updating', 'removing', 'failed', 'paused');--> statement-breakpoint
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
ALTER TABLE "deployment_jobs" ADD CONSTRAINT "deployment_jobs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_assignments" ADD CONSTRAINT "network_assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestration_stacks" ADD CONSTRAINT "orchestration_stacks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_allocations" ADD CONSTRAINT "resource_allocations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_instances" ADD CONSTRAINT "service_instances_stack_id_orchestration_stacks_id_fk" FOREIGN KEY ("stack_id") REFERENCES "public"."orchestration_stacks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_instances" ADD CONSTRAINT "service_instances_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssl_certificates" ADD CONSTRAINT "ssl_certificates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;