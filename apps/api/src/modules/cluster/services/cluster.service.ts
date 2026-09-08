/**
 * ClusterService — platform-facing facade over the Swarm cluster (SW-003).
 * Implements the data needs of the `cluster` ORPC contract using the
 * swarm core services (bootstrap/snapshot, election, inventory, placement).
 */

import { Injectable, Logger } from "@nestjs/common";
import { Observable } from "rxjs";
import type { ClusterSnapshot, ClusterNode, SwarmNodeResources, SwarmServiceRuntime, SwarmTaskRuntime } from "@repo/contracts-entities";
import { clusterNodeInventoryRowSchema } from "@repo/api-contracts";
import type { ClusterMasterView } from "@repo/api-contracts";
import { SwarmClusterService } from "@/core/modules/swarm/services/swarm-cluster.service";
import { SwarmFleetService } from "@/core/modules/swarm/services/swarm-fleet.service";
import { ClusterNodeRepository } from "@/core/modules/swarm/repositories/cluster-node.repository";
import { ClusterNodeInventoryRepository } from "@/core/modules/swarm/repositories/cluster-node-inventory.repository";

@Injectable()
export class ClusterService {
    private readonly logger = new Logger(ClusterService.name);

    constructor(
        private readonly swarmClusterService: SwarmClusterService,
        private readonly swarmFleetService: SwarmFleetService,
        private readonly clusterNodeRepository: ClusterNodeRepository,
        private readonly inventoryRepository: ClusterNodeInventoryRepository,
    ) {}

    /** Local engine's current Swarm snapshot (typed). */
    async getSnapshot(): Promise<ClusterSnapshot> {
        return this.swarmClusterService.getLocalClusterSnapshot();
    }

    /** Observable stream of node resources at 10s intervals. */
    nodeResourcesStream$(nodeId: string) {
        return new Observable<SwarmNodeResources>((subscriber) => {
            const push = () => {
                this.swarmFleetService
                    .getNodeResources(nodeId)
                    .then((resources) => subscriber.next(resources))
                    .catch((err) => this.logger.warn(`Node resources stream error: ${err}`));
            };
            push();
            const timer = setInterval(push, 10_000);
            return () => clearInterval(timer);
        });
    }

    /** Observable stream of cluster snapshots at 30s intervals. */
    snapshotStream$() {
        return new Observable<ClusterSnapshot>((subscriber) => {
            const push = () => {
                this.swarmClusterService
                    .getLocalClusterSnapshot()
                    .then((snapshot) => subscriber.next(snapshot))
                    .catch((err) => this.logger.warn(`Snapshot stream error: ${err}`));
            };
            push(); // initial push
            const timer = setInterval(push, 30_000);
            return () => clearInterval(timer);
        });
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

    // ─── Fleet workload surface (services / tasks / node resources) ────────

    /** Mesh-wide swarm services with mode + desired/running task counts. */
    async listServices(): Promise<SwarmServiceRuntime[]> {
        return this.swarmFleetService.listServices();
    }

    /** Swarm tasks filtered by service and/or node. */
    async listTasks(filter: { serviceId?: string; nodeId?: string }): Promise<SwarmTaskRuntime[]> {
        return this.swarmFleetService.listTasks(filter);
    }

    /** Per-node aggregation (swarm services/tasks + local engine artifacts). */
    async getNodeResources(nodeId: string): Promise<SwarmNodeResources> {
        return this.swarmFleetService.getNodeResources(nodeId);
    }
}