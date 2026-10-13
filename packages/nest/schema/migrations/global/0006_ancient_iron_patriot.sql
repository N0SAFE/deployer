CREATE TYPE "public"."cluster_admission_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."cluster_allocation_mode" AS ENUM('dedicated_full', 'dedicated_slice', 'shared_slice');--> statement-breakpoint
CREATE TYPE "public"."cluster_join_grant_status" AS ENUM('issued', 'used', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."cluster_node_status" AS ENUM('active', 'suspect', 'draining', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."cluster_signing_key_status" AS ENUM('active', 'previous', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."local_job_state" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."local_outbox_state" AS ENUM('pending', 'sent', 'failed', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."resource_ownership_status" AS ENUM('active', 'stale', 'revoked');--> statement-breakpoint
CREATE TABLE "cluster_join_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text,
	"grant_token_hash" text NOT NULL,
	"status" "cluster_join_grant_status" DEFAULT 'issued' NOT NULL,
	"issued_by_user_id" text,
	"target_node_id" uuid,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"revoked_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cluster_node_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"organization_id" text,
	"metrics" jsonb NOT NULL,
	"metric_version" integer DEFAULT 1 NOT NULL,
	"reported_at" timestamp NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cluster_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"server_url" text NOT NULL,
	"display_name" text,
	"status" "cluster_node_status" DEFAULT 'active' NOT NULL,
	"healthy" boolean DEFAULT true NOT NULL,
	"capabilities" jsonb,
	"max_cpu_millicores" integer,
	"max_memory_mb" integer,
	"metadata" jsonb,
	"enrolled_at" timestamp NOT NULL,
	"last_seen_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cluster_org_admission_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
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
CREATE TABLE "cluster_org_server_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
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
CREATE TABLE "cluster_signing_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kid" text NOT NULL,
	"algorithm" text DEFAULT 'HS256' NOT NULL,
	"status" "cluster_signing_key_status" DEFAULT 'active' NOT NULL,
	"secret_material" text NOT NULL,
	"public_jwk" jsonb,
	"activated_at" timestamp NOT NULL,
	"expires_at" timestamp,
	"rotated_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_event_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace" text NOT NULL,
	"event_name" text NOT NULL,
	"event_key" text NOT NULL,
	"sequence" integer NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb NOT NULL,
	"emitted_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_build_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"cache_key" text NOT NULL,
	"storage_path" text NOT NULL,
	"size_bytes" integer,
	"metadata" jsonb,
	"created_at" timestamp NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "local_event_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"state" "local_outbox_state" DEFAULT 'pending' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_queue_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"deployment_run_id" uuid,
	"job_type" text NOT NULL,
	"state" "local_job_state" DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_runtime_processes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"deployment_run_id" uuid,
	"service_id" uuid,
	"container_name" text,
	"process_key" text,
	"status" text NOT NULL,
	"metadata" jsonb,
	"started_at" timestamp,
	"stopped_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_role_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"role_name" text NOT NULL,
	"resource_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_role" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"role" text NOT NULL,
	"permission" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "resource_ownership_index" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text,
	"resource_kind" text NOT NULL,
	"resource_key" text NOT NULL,
	"owner_node_id" uuid NOT NULL,
	"owner_server_url" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" "resource_ownership_status" DEFAULT 'active' NOT NULL,
	"lease_holder_node_id" uuid,
	"lease_expires_at" timestamp,
	"version" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb,
	"observed_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cluster_join_grants" ADD CONSTRAINT "cluster_join_grants_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_join_grants" ADD CONSTRAINT "cluster_join_grants_issued_by_user_id_user_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cluster_nodes_node_id_uidx" ON "cluster_nodes" USING btree ("node_id");--> statement-breakpoint
ALTER TABLE "cluster_node_metrics" ADD CONSTRAINT "cluster_node_metrics_node_id_cluster_nodes_node_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."cluster_nodes"("node_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_node_metrics" ADD CONSTRAINT "cluster_node_metrics_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_org_admission_requests" ADD CONSTRAINT "cluster_org_admission_requests_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_org_admission_requests" ADD CONSTRAINT "cluster_org_admission_requests_requested_server_node_id_cluster_nodes_node_id_fk" FOREIGN KEY ("requested_server_node_id") REFERENCES "public"."cluster_nodes"("node_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_org_admission_requests" ADD CONSTRAINT "cluster_org_admission_requests_decision_server_node_id_cluster_nodes_node_id_fk" FOREIGN KEY ("decision_server_node_id") REFERENCES "public"."cluster_nodes"("node_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_org_admission_requests" ADD CONSTRAINT "cluster_org_admission_requests_requester_user_id_user_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_org_admission_requests" ADD CONSTRAINT "cluster_org_admission_requests_reviewed_by_user_id_user_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_org_server_allocations" ADD CONSTRAINT "cluster_org_server_allocations_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_org_server_allocations" ADD CONSTRAINT "cluster_org_server_allocations_server_node_id_cluster_nodes_node_id_fk" FOREIGN KEY ("server_node_id") REFERENCES "public"."cluster_nodes"("node_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_org_server_allocations" ADD CONSTRAINT "cluster_org_server_allocations_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_role_rules" ADD CONSTRAINT "org_role_rules_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_role" ADD CONSTRAINT "organization_role_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_ownership_index" ADD CONSTRAINT "resource_ownership_index_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_ownership_index" ADD CONSTRAINT "resource_ownership_index_owner_node_id_cluster_nodes_node_id_fk" FOREIGN KEY ("owner_node_id") REFERENCES "public"."cluster_nodes"("node_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_ownership_index" ADD CONSTRAINT "resource_ownership_index_lease_holder_node_id_cluster_nodes_node_id_fk" FOREIGN KEY ("lease_holder_node_id") REFERENCES "public"."cluster_nodes"("node_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cluster_join_grants_token_hash_uidx" ON "cluster_join_grants" USING btree ("grant_token_hash");--> statement-breakpoint
CREATE INDEX "cluster_join_grants_cluster_status_idx" ON "cluster_join_grants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cluster_join_grants_expires_at_idx" ON "cluster_join_grants" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "cluster_node_metrics_cluster_node_reported_idx" ON "cluster_node_metrics" USING btree ("node_id","reported_at");--> statement-breakpoint
CREATE INDEX "cluster_node_metrics_org_reported_idx" ON "cluster_node_metrics" USING btree ("organization_id","reported_at");--> statement-breakpoint
CREATE INDEX "cluster_nodes_cluster_status_idx" ON "cluster_nodes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cluster_org_admission_requests_org_status_idx" ON "cluster_org_admission_requests" USING btree ("organization_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "cluster_org_admission_requests_status_idx" ON "cluster_org_admission_requests" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "cluster_org_admission_requests_cluster_idx" ON "cluster_org_admission_requests" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cluster_org_server_allocations_unique_uidx" ON "cluster_org_server_allocations" USING btree ("organization_id","server_node_id");--> statement-breakpoint
CREATE INDEX "cluster_org_server_allocations_org_idx" ON "cluster_org_server_allocations" USING btree ("organization_id","updated_at");--> statement-breakpoint
CREATE INDEX "cluster_org_server_allocations_server_idx" ON "cluster_org_server_allocations" USING btree ("server_node_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cluster_signing_keys_kid_uidx" ON "cluster_signing_keys" USING btree ("kid");--> statement-breakpoint
CREATE INDEX "cluster_signing_keys_cluster_status_idx" ON "cluster_signing_keys" USING btree ("status");--> statement-breakpoint
CREATE INDEX "core_event_logs_namespace_idx" ON "core_event_logs" USING btree ("namespace");--> statement-breakpoint
CREATE INDEX "core_event_logs_event_name_idx" ON "core_event_logs" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "core_event_logs_event_key_idx" ON "core_event_logs" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "core_event_logs_emitted_at_idx" ON "core_event_logs" USING btree ("emitted_at");--> statement-breakpoint
CREATE INDEX "local_build_cache_node_idx" ON "local_build_cache" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "local_build_cache_cache_key_idx" ON "local_build_cache" USING btree ("cache_key");--> statement-breakpoint
CREATE INDEX "local_event_outbox_node_state_idx" ON "local_event_outbox" USING btree ("node_id","state");--> statement-breakpoint
CREATE INDEX "local_event_outbox_topic_idx" ON "local_event_outbox" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "local_queue_jobs_node_state_idx" ON "local_queue_jobs" USING btree ("node_id","state");--> statement-breakpoint
CREATE INDEX "local_queue_jobs_deployment_idx" ON "local_queue_jobs" USING btree ("deployment_run_id");--> statement-breakpoint
CREATE INDEX "local_runtime_processes_node_status_idx" ON "local_runtime_processes" USING btree ("node_id","status");--> statement-breakpoint
CREATE INDEX "local_runtime_processes_service_idx" ON "local_runtime_processes" USING btree ("service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_role_rules_orgId_roleName_uidx" ON "org_role_rules" USING btree ("organization_id","role_name");--> statement-breakpoint
CREATE INDEX "org_role_rules_orgId_idx" ON "org_role_rules" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organizationRole_organizationId_idx" ON "organization_role" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organizationRole_role_idx" ON "organization_role" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_ownership_index_unique_owner_uidx" ON "resource_ownership_index" USING btree ("organization_id","resource_kind","resource_key","owner_node_id");--> statement-breakpoint
CREATE INDEX "resource_ownership_index_lookup_idx" ON "resource_ownership_index" USING btree ("organization_id","resource_kind","resource_key","status");--> statement-breakpoint
CREATE INDEX "resource_ownership_index_owner_node_idx" ON "resource_ownership_index" USING btree ("owner_node_id");