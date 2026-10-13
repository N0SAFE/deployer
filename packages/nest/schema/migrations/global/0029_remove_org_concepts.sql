CREATE TYPE "public"."analytics_report_config_schedule" AS ENUM('none', 'daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."analytics_report_format" AS ENUM('json', 'pdf', 'csv');--> statement-breakpoint
CREATE TYPE "public"."analytics_report_status" AS ENUM('pending', 'generating', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "analytics_report_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"metrics" jsonb NOT NULL,
	"filters" jsonb,
	"schedule" "analytics_report_config_schedule" DEFAULT 'none' NOT NULL,
	"recipients" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" "analytics_report_status" DEFAULT 'pending' NOT NULL,
	"format" "analytics_report_format" DEFAULT 'json' NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb,
	"content" jsonb,
	"size_bytes" integer DEFAULT 0,
	"error_message" text,
	"generated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cluster_admission_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "cluster_admission_request_status" DEFAULT 'pending' NOT NULL,
	"requested_server_node_id" uuid,
	"decision_server_node_id" uuid,
	"requested_cpu_millicores" integer DEFAULT 0 NOT NULL,
	"requested_memory_mb" integer DEFAULT 0 NOT NULL,
	"requested_services" integer DEFAULT 1 NOT NULL,
	"requester_user_id" text,
	"requester_note" text,
	"reviewed_by_user_id" text,
	"reviewer_note" text,
	"reviewed_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cluster_server_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_node_id" uuid NOT NULL,
	"allocation_mode" "cluster_allocation_mode" DEFAULT 'shared_slice' NOT NULL,
	"cpu_millicores" integer DEFAULT 0 NOT NULL,
	"memory_mb" integer DEFAULT 0 NOT NULL,
	"max_services" integer,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cluster_org_admission_requests" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cluster_org_server_allocations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitation" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_domains" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_role" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_member" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "cluster_org_admission_requests" CASCADE;--> statement-breakpoint
DROP TABLE "cluster_org_server_allocations" CASCADE;--> statement-breakpoint
DROP TABLE "invitation" CASCADE;--> statement-breakpoint
DROP TABLE "member" CASCADE;--> statement-breakpoint
DROP TABLE "organization" CASCADE;--> statement-breakpoint
DROP TABLE "organization_domains" CASCADE;--> statement-breakpoint
DROP TABLE "organization_role" CASCADE;--> statement-breakpoint
DROP TABLE "team" CASCADE;--> statement-breakpoint
DROP TABLE "team_member" CASCADE;--> statement-breakpoint
ALTER TABLE "cluster_join_grants" DROP CONSTRAINT IF EXISTS "cluster_join_grants_organization_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "cluster_node_metrics" DROP CONSTRAINT IF EXISTS "cluster_node_metrics_organization_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "org_role_rules" DROP CONSTRAINT IF EXISTS "org_role_rules_organization_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "project_domains" DROP CONSTRAINT IF EXISTS "project_domains_organization_domain_id_organization_domains_id_fk";
--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_organization_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "resource_ownership_index" DROP CONSTRAINT IF EXISTS "resource_ownership_index_organization_id_organization_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "cluster_node_metrics_org_reported_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "github_apps_org_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "gitlab_apps_org_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "org_role_rules_orgId_roleName_uidx";--> statement-breakpoint
DROP INDEX IF EXISTS "org_role_rules_orgId_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "resource_ownership_index_unique_owner_uidx";--> statement-breakpoint
DROP INDEX IF EXISTS "resource_ownership_index_lookup_idx";--> statement-breakpoint
ALTER TABLE "project_domains" ADD COLUMN "domain" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "project_domains" ADD COLUMN "verification_status" "verification_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_domains" ADD COLUMN "verification_method" "verification_method" DEFAULT 'txt_record' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_domains" ADD COLUMN "verification_token" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "project_domains" ADD COLUMN "dns_record_checked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_domains" ADD COLUMN "last_verification_attempt" timestamp;--> statement-breakpoint
ALTER TABLE "project_domains" ADD COLUMN "verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "cluster_admission_requests" ADD CONSTRAINT "cluster_admission_requests_requested_server_node_id_cluster_nodes_node_id_fk" FOREIGN KEY ("requested_server_node_id") REFERENCES "public"."cluster_nodes"("node_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_admission_requests" ADD CONSTRAINT "cluster_admission_requests_decision_server_node_id_cluster_nodes_node_id_fk" FOREIGN KEY ("decision_server_node_id") REFERENCES "public"."cluster_nodes"("node_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_admission_requests" ADD CONSTRAINT "cluster_admission_requests_requester_user_id_user_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_admission_requests" ADD CONSTRAINT "cluster_admission_requests_reviewed_by_user_id_user_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_server_allocations" ADD CONSTRAINT "cluster_server_allocations_server_node_id_cluster_nodes_node_id_fk" FOREIGN KEY ("server_node_id") REFERENCES "public"."cluster_nodes"("node_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_server_allocations" ADD CONSTRAINT "cluster_server_allocations_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_report_configs_schedule_idx" ON "analytics_report_configs" USING btree ("schedule");--> statement-breakpoint
CREATE INDEX "analytics_reports_status_idx" ON "analytics_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "analytics_reports_period_start_idx" ON "analytics_reports" USING btree ("period_start");--> statement-breakpoint
CREATE INDEX "cluster_admission_requests_status_idx" ON "cluster_admission_requests" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "cluster_admission_requests_cluster_idx" ON "cluster_admission_requests" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cluster_server_allocations_unique_uidx" ON "cluster_server_allocations" USING btree ("server_node_id");--> statement-breakpoint
CREATE INDEX "cluster_server_allocations_server_idx" ON "cluster_server_allocations" USING btree ("server_node_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "org_role_rules_roleName_uidx" ON "org_role_rules" USING btree ("role_name");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_ownership_index_unique_owner_uidx" ON "resource_ownership_index" USING btree ("resource_kind","resource_key","owner_node_id");--> statement-breakpoint
CREATE INDEX "resource_ownership_index_lookup_idx" ON "resource_ownership_index" USING btree ("resource_kind","resource_key","status");--> statement-breakpoint
ALTER TABLE "cluster_join_grants" DROP COLUMN "organization_id";--> statement-breakpoint
ALTER TABLE "cluster_node_metrics" DROP COLUMN "organization_id";--> statement-breakpoint
ALTER TABLE "github_apps" DROP COLUMN "organization_id";--> statement-breakpoint
ALTER TABLE IF EXISTS "gitlab_apps" DROP COLUMN "organization_id";--> statement-breakpoint
ALTER TABLE "org_role_rules" DROP COLUMN "organization_id";--> statement-breakpoint
ALTER TABLE "project_domains" DROP COLUMN "organization_domain_id";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "organization_id";--> statement-breakpoint
ALTER TABLE "resource_ownership_index" DROP COLUMN "organization_id";--> statement-breakpoint
ALTER TABLE "session" DROP COLUMN "active_organization_id";--> statement-breakpoint
ALTER TABLE "session" DROP COLUMN "active_team_id";