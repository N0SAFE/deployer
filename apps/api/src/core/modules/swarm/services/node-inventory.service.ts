/**
 * NodeInventoryService — periodic fleet inventory sync (SW-030,
 * docs/swarm-orchestration/P3). Every cadence it pulls `docker node ls`
 * through the SDK, upserts each node into the local `cluster_nodes` table,
 * and marks previously-seen nodes that vanished as `down` (drift).
 *
 * Best-effort: an engine/persist failure logs a warning; the platform keeps
 * serving from the last good snapshot. Fully unit-testable with mocks.
 */

import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { SwarmClusterService } from "../services/swarm-cluster.service";
import { GlobalClusterNodesRepository } from "../repositories/global-cluster-nodes.repository";
import {
    ClusterNodeInventoryRepository,
    toEngineNodeRow,
} from "../repositories/cluster-node-inventory.repository";

@Injectable()
export class NodeInventoryService implements OnModuleInit, OnModuleDestroy {
    private static readonly DEFAULT_SYNC_INTERVAL_MS = 30_000;
    private static readonly START_DELAY_MS = 5_000;

    private readonly logger = new Logger(NodeInventoryService.name);
    private timer: NodeJS.Timeout | null = null;

    constructor(
        private readonly clusterService: SwarmClusterService,
        private readonly inventoryRepository: ClusterNodeInventoryRepository,
        private readonly globalClusterNodes: GlobalClusterNodesRepository,
    ) {}

    onModuleInit(): void {
        // Enroll the LOCAL platform node into the shared cluster_nodes table
        // IMMEDIATELY (not after the first 5s sweep) so mesh resource-ownership
        // inserts (FK → cluster_nodes.node_id) never fail at registration.
        void this.globalClusterNodes.enrollLocalNode().catch((error: unknown) => {
            this.logger.warn(
                `Global node enrollment failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        });

        this.timer = setTimeout(
            () => {
                void this.syncOnce()
                    .catch((error: unknown) => {
                        this.logger.warn(
                            `Fleet inventory sync failed: ${error instanceof Error ? error.message : String(error)}`,
                        );
                    })
                    .finally(() => this.scheduleNext());
            },
            NodeInventoryService.START_DELAY_MS,
        );
    }

    onModuleDestroy(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private get intervalMs(): number {
        return 30_000; // env knob follow-up: SWARM_INVENTORY_SYNC_MS
    }

    private scheduleNext(): void {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => {
            void this.syncOnce()
                .catch((error: unknown) => {
                    this.logger.warn(
                        `Fleet inventory sync failed: ${error instanceof Error ? error.message : String(error)}`,
                    );
                })
                .finally(() => this.scheduleNext());
        }, this.intervalMs);
    }

    /**
     * One sync pass: engine nodes → upsert each → mark vanished as down.
     * Returns the number of nodes persisted. Public for tests.
     */
    async syncOnce(): Promise<number> {
        // Cluster gate: nothing to inventory outside an active swarm.
        const snapshot = await this.clusterService.getLocalClusterSnapshot();
        if (snapshot.localNodeState !== "active") {
            return 0;
        }

        const nodes = await this.clusterService.listSwarmNodes();
        for (const node of nodes) {
            this.inventoryRepository.upsertFromEngine(toEngineNodeRow(node));
        }
        const markedDown = this.inventoryRepository.markMissingNodeDown(nodes.map((node) => node.ID));
        this.logger.debug(
            `Fleet inventory synced: ${String(nodes.length)} nodes, ${String(markedDown)} marked down`,
        );

        // Keep the shared cluster_nodes enrollment fresh (heartbeat) on every sweep.
        try {
            await this.globalClusterNodes.enrollLocalNode();
        } catch (error: unknown) {
            this.logger.warn(
                `Global node enrollment failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        return nodes.length;
    }
}