/**
 * ClusterService — platform-facing facade over the Swarm cluster (SW-003).
 * Implements the data needs of the `cluster` ORPC contract using the
 * swarm core services (bootstrap/snapshot, election, inventory, placement).
 */

import { Injectable, Logger } from "@nestjs/common";
import type { ClusterSnapshot, ClusterNode } from "@repo/contracts-entities";
import { clusterNodeInventoryRowSchema } from "@repo/api-contracts";
import type { ClusterMasterView } from "@repo/api-contracts";
import { SwarmClusterService } from "@/core/modules/swarm/services/swarm-cluster.service";
import { ClusterNodeRepository } from "@/core/modules/swarm/repositories/cluster-node.repository";
import { ClusterNodeInventoryRepository } from "@/core/modules/swarm/repositories/cluster-node-inventory.repository";

@Injectable()
export class ClusterService {
    private readonly logger = new Logger(ClusterService.name);

    constructor(
        private readonly swarmClusterService: SwarmClusterService,
        private readonly clusterNodeRepository: ClusterNodeRepository,
        private readonly inventoryRepository: ClusterNodeInventoryRepository,
    ) {}

    /** Local engine's current Swarm snapshot (typed). */
    async getSnapshot(): Promise<ClusterSnapshot> {
        return this.swarmClusterService.getLocalClusterSnapshot();
    }

    /**
     * Fleet inventory from the persisted `cluster_nodes` table (fast, no
     * live engine call). Falls back to a live sweep when the table is empty.
     */
    async listNodes(includeDown: boolean): Promise<
        ReturnType<typeof clusterNodeInventoryRowSchema.parse>[]
    > {
        let rows = this.inventoryRepository.list();
        if (!includeDown) {
            rows = rows.filter((row) => row.state === "active");
        }

        if (rows.length === 0) {
            // Fallback: live engine sweep for fresh installs before the first
            // inventory timer ticks.
            try {
                this.inventoryRepository.upsertAllFromEngine(
                    await this.swarmClusterService.listSwarmNodes(),
                );
            } catch (error: unknown) {
                this.logger.warn(
                    `Fleet inventory fallback sweep failed: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
            rows = this.inventoryRepository.list();
            if (!includeDown) {
                rows = rows.filter((row) => row.state === "active");
            }
        }

        return rows.map((row) =>
            clusterNodeInventoryRowSchema.parse({
                nodeId: row.nodeId,
                hostname: row.hostname,
                swarmRole: row.swarmRole,
                platformRole: row.platformRole,
                isMaster: row.isLeader,
                isIngress: row.isIngress,
                availability: row.availability,
                capacity: {
                    nanoCpus: row.nanoCpus,
                    memoryBytes: row.memoryBytes,
                },
                labels: row.labels,
                lastHeartbeatAt: row.lastSeenAt,
                isLeader: row.isLeader,
                state: row.state,
                lastSeenAt: row.lastSeenAt,
            }),
        );
    }

    /**
     * Current controlling-master view (elected node + term + heartbeat state).
     */
    async getMaster(): Promise<ClusterMasterView> {
        const row = this.clusterNodeRepository.find();
        if (!row?.masterNodeId) {
            return null;
        }
        const heartbeatAt = row.lastHeartbeatAt ? Date.parse(row.lastHeartbeatAt) : 0;
        const ttlMs = 30_000;
        const graceMs = 15_000;
        const stale = heartbeatAt > 0 && Date.now() - heartbeatAt > ttlMs + graceMs;
        return {
            nodeId: row.masterNodeId,
            term: row.masterTerm,
            electedAt: row.lastHeartbeatAt ?? "",
            heartbeatAt: row.lastHeartbeatAt ?? "",
            reason: "elected",
            state: stale ? "suspect" : "healthy",
        };
    }

    /**
     * Update a node's platform role / ingress labels via the SDK
     * (node.update Spec.Labels — SW-031) and persist to the inventory.
     */
    async updateNodeLabels(nodeId: string, input: {
        platformRole?: "both" | "control" | "worker";
        ingress?: boolean;
    }): Promise<ClusterNode> {
        const node = await this.swarmClusterService.inspectSwarmNode(nodeId);

        const labels = { ...(node.Spec?.Labels ?? {}) };
        if (input.ingress === true) {
            labels["deployer.ingress"] = "true";
        } else if (input.ingress === false) {
            delete labels["deployer.ingress"];
        }

        const row = this.clusterNodeRepository.find();
        const platformRole = input.platformRole ?? (row?.platformRole ?? "both");

        await this.swarmClusterService.updateSwarmNodeLabels(
            nodeId,
            node.Version.Index,
            labels,
        );

        // Persist the updated role/ingress into the local inventory.
        const hostname = node.Description?.Hostname ?? "";
        this.inventoryRepository.upsertFromEngine({
            nodeId,
            hostname,
            swarmRole: node.Spec?.Role === "manager" ? "manager" : "worker",
            platformRole,
            isLeader: node.ManagerStatus?.Leader === true,
            isIngress: labels["deployer.ingress"] === "true",
            availability:
                node.Spec?.Availability === "pause" || node.Spec?.Availability === "drain"
                    ? node.Spec.Availability
                    : "active",
            nanoCpus: node.Description?.Resources?.NanoCPUs ?? null,
            memoryBytes: node.Description?.Resources?.MemoryBytes ?? null,
            labels,
        });

        return {
            nodeId,
            hostname,
            swarmRole: node.Spec?.Role === "manager" ? "manager" : "worker",
            platformRole,
            isMaster: node.ManagerStatus?.Leader === true,
            isIngress: labels["deployer.ingress"] === "true",
            availability:
                node.Spec?.Availability === "pause" || node.Spec?.Availability === "drain"
                    ? node.Spec.Availability
                    : "active",
            capacity: {
                nanoCpus: node.Description?.Resources?.NanoCPUs ?? null,
                memoryBytes: node.Description?.Resources?.MemoryBytes ?? null,
            },
            labels,
            lastHeartbeatAt: new Date().toISOString(),
        };
    }
}