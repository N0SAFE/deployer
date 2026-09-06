/**
 * GlobalClusterNodesRepository — enrolls the LOCAL platform node into the
 * shared (Postgres) `cluster_nodes` table.
 *
 * Why: `resource_ownership_index.owner_node_id` and `cluster_join_grants`
 * have hard FKs → `cluster_nodes.node_id` (the platform UUID). If the node
 * is never enrolled, every mesh resource registration fails with a foreign
 * key violation. The fleet view (`FleetRepository.listServersWithMetrics`)
 * also reads this table.
 *
 * The row is keyed by the PLATFORM node UUID (`SystemMeshConfigService.getNodeId()`,
 * same as `node_config.nodeId`) — NOT the docker engine node id (non-uuid).
 */

import { Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { clusterNodes } from "@/config/drizzle/global/schema/cluster";
import { GlobalDatabaseService } from "@/core/modules/database/global/global-database.service";
import { SystemMeshConfigService } from "@/core/modules/mesh/services/system-mesh-config.service";

@Injectable()
export class GlobalClusterNodesRepository {
    private readonly logger = new Logger(GlobalClusterNodesRepository.name);

    constructor(
        private readonly db: GlobalDatabaseService,
        private readonly meshConfig: SystemMeshConfigService,
    ) {}

    /**
     * Upsert the local platform node (idempotent by the unique `node_id`).
     * Returns true when the node is enrolled, false when identity/url are
     * unresolvable (callers treat as best-effort).
     */
    async enrollLocalNode(): Promise<boolean> {
        const nodeId = this.meshConfig.getNodeId();
        if (nodeId.length === 0) {
            return false;
        }
        const serverUrl = this.meshConfig.getNodeServerUrl();
        const now = new Date();

        await this.db.db
            .insert(clusterNodes)
            .values({
                nodeId,
                serverUrl: serverUrl ?? "http://localhost",
                displayName: `node-${nodeId.slice(0, 8)}`,
                status: "active",
                healthy: true,
                lastSeenAt: now,
                updatedAt: now,
            })
            .onConflictDoUpdate({
                target: clusterNodes.nodeId,
                set: {
                    serverUrl: serverUrl ?? "http://localhost",
                    status: "active",
                    healthy: true,
                    lastSeenAt: now,
                    updatedAt: now,
                },
            });

        return true;
    }
}