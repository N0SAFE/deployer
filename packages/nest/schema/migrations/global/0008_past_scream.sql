DROP INDEX "cluster_join_grants_cluster_status_idx";--> statement-breakpoint
DROP INDEX "cluster_node_metrics_cluster_node_reported_idx";--> statement-breakpoint
DROP INDEX "cluster_nodes_cluster_status_idx";--> statement-breakpoint
DROP INDEX "cluster_org_admission_requests_cluster_idx";--> statement-breakpoint
DROP INDEX "cluster_org_server_allocations_unique_uidx";--> statement-breakpoint
DROP INDEX "cluster_signing_keys_cluster_status_idx";--> statement-breakpoint
DROP INDEX "resource_ownership_index_unique_owner_uidx";--> statement-breakpoint
DROP INDEX "resource_ownership_index_lookup_idx";--> statement-breakpoint
CREATE INDEX "cluster_join_grants_cluster_status_idx" ON "cluster_join_grants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cluster_node_metrics_cluster_node_reported_idx" ON "cluster_node_metrics" USING btree ("node_id","reported_at");--> statement-breakpoint
CREATE INDEX "cluster_nodes_cluster_status_idx" ON "cluster_nodes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cluster_org_admission_requests_cluster_idx" ON "cluster_org_admission_requests" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cluster_org_server_allocations_unique_uidx" ON "cluster_org_server_allocations" USING btree ("organization_id","server_node_id");--> statement-breakpoint
CREATE INDEX "cluster_signing_keys_cluster_status_idx" ON "cluster_signing_keys" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_ownership_index_unique_owner_uidx" ON "resource_ownership_index" USING btree ("organization_id","resource_kind","resource_key","owner_node_id");--> statement-breakpoint
CREATE INDEX "resource_ownership_index_lookup_idx" ON "resource_ownership_index" USING btree ("organization_id","resource_kind","resource_key","status");--> statement-breakpoint
ALTER TABLE "cluster_join_grants" DROP COLUMN IF EXISTS "cluster_id";--> statement-breakpoint
ALTER TABLE "cluster_node_metrics" DROP COLUMN IF EXISTS "cluster_id";--> statement-breakpoint
ALTER TABLE "cluster_nodes" DROP COLUMN IF EXISTS "cluster_id";--> statement-breakpoint
ALTER TABLE "cluster_org_admission_requests" DROP COLUMN IF EXISTS "cluster_id";--> statement-breakpoint
ALTER TABLE "cluster_org_server_allocations" DROP COLUMN IF EXISTS "cluster_id";--> statement-breakpoint
ALTER TABLE "cluster_signing_keys" DROP COLUMN IF EXISTS "cluster_id";--> statement-breakpoint
ALTER TABLE "resource_ownership_index" DROP COLUMN IF EXISTS "cluster_id";