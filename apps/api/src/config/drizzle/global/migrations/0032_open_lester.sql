ALTER TABLE "cluster_admission_requests" ALTER COLUMN "requested_server_node_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "cluster_admission_requests" ALTER COLUMN "decision_server_node_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "cluster_join_grants" ALTER COLUMN "target_node_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "cluster_node_metrics" ALTER COLUMN "node_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "cluster_nodes" ALTER COLUMN "node_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "cluster_server_allocations" ALTER COLUMN "server_node_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "local_build_cache" ALTER COLUMN "node_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "local_event_outbox" ALTER COLUMN "node_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "local_queue_jobs" ALTER COLUMN "node_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "local_runtime_processes" ALTER COLUMN "node_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "node_network_config" ALTER COLUMN "node_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "resource_ownership_index" ALTER COLUMN "owner_node_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "resource_ownership_index" ALTER COLUMN "lease_holder_node_id" SET DATA TYPE text;