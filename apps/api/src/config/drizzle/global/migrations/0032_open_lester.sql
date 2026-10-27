-- Drop FK constraints that reference cluster_nodes.node_id before altering types
ALTER TABLE "cluster_admission_requests" DROP CONSTRAINT IF EXISTS "cluster_admission_requests_requested_server_node_id_cluster_nod";
ALTER TABLE "cluster_admission_requests" DROP CONSTRAINT IF EXISTS "cluster_admission_requests_decision_server_node_id_cluster_node";
ALTER TABLE "cluster_node_metrics" DROP CONSTRAINT IF EXISTS "cluster_node_metrics_node_id_cluster_nodes_node_id_fk";
ALTER TABLE "cluster_server_allocations" DROP CONSTRAINT IF EXISTS "cluster_server_allocations_server_node_id_cluster_nodes_node_id";
ALTER TABLE "resource_ownership_index" DROP CONSTRAINT IF EXISTS "resource_ownership_index_owner_node_id_cluster_nodes_node_id_fk";
ALTER TABLE "resource_ownership_index" DROP CONSTRAINT IF EXISTS "resource_ownership_index_lease_holder_node_id_cluster_nodes_nod";
--> statement-breakpoint
-- Alter node_id columns from uuid to text
ALTER TABLE "cluster_nodes" ALTER COLUMN "node_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "cluster_admission_requests" ALTER COLUMN "requested_server_node_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "cluster_admission_requests" ALTER COLUMN "decision_server_node_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "cluster_join_grants" ALTER COLUMN "target_node_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "cluster_node_metrics" ALTER COLUMN "node_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "cluster_server_allocations" ALTER COLUMN "server_node_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "local_build_cache" ALTER COLUMN "node_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "local_event_outbox" ALTER COLUMN "node_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "local_queue_jobs" ALTER COLUMN "node_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "local_runtime_processes" ALTER COLUMN "node_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "node_network_config" ALTER COLUMN "node_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "resource_ownership_index" ALTER COLUMN "owner_node_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "resource_ownership_index" ALTER COLUMN "lease_holder_node_id" SET DATA TYPE text;
--> statement-breakpoint
-- Re-add FK constraints with text type
ALTER TABLE "cluster_admission_requests" ADD CONSTRAINT "cluster_admission_requests_requested_server_node_id_cluster_nod" FOREIGN KEY ("requested_server_node_id") REFERENCES "cluster_nodes"("node_id") ON DELETE cascade;
ALTER TABLE "cluster_admission_requests" ADD CONSTRAINT "cluster_admission_requests_decision_server_node_id_cluster_node" FOREIGN KEY ("decision_server_node_id") REFERENCES "cluster_nodes"("node_id") ON DELETE cascade;
ALTER TABLE "cluster_node_metrics" ADD CONSTRAINT "cluster_node_metrics_node_id_cluster_nodes_node_id_fk" FOREIGN KEY ("node_id") REFERENCES "cluster_nodes"("node_id") ON DELETE cascade;
ALTER TABLE "cluster_server_allocations" ADD CONSTRAINT "cluster_server_allocations_server_node_id_cluster_nodes_node_id" FOREIGN KEY ("server_node_id") REFERENCES "cluster_nodes"("node_id") ON DELETE cascade;
ALTER TABLE "resource_ownership_index" ADD CONSTRAINT "resource_ownership_index_owner_node_id_cluster_nodes_node_id_fk" FOREIGN KEY ("owner_node_id") REFERENCES "cluster_nodes"("node_id") ON DELETE cascade;
ALTER TABLE "resource_ownership_index" ADD CONSTRAINT "resource_ownership_index_lease_holder_node_id_cluster_nodes_nod" FOREIGN KEY ("lease_holder_node_id") REFERENCES "cluster_nodes"("node_id") ON DELETE set null;