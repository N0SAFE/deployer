/**
 * ClusterService — platform-facing facade over the Swarm cluster (SW-003).
 * Implements the data needs of the `cluster` ORPC contract using the
 * swarm core services (bootstrap/snapshot, election, inventory, placement).
 */

import { Injectable, Logger } from "@nestjs/common";
import { Observable } from "rxjs";
import type { ClusterPlatformRole, ClusterSnapshot, ClusterNode, SwarmNodeResources, SwarmServiceRuntime, SwarmTaskRuntime, SwarmConfigView, SwarmParticipationInput } from "@repo/contracts-entities";
import { clusterNodeInventoryRowSchema } from "@repo/api-contracts";
import type { ClusterMasterView } from "@repo/api-contracts";
import { SwarmClusterService } from "@repo/nest-swarm";
import { SwarmFleetService } from "@repo/nest-swarm";
import { SwarmParticipationService } from "@repo/nest-swarm";
import { DockerService } from "@repo/nest-docker/services/docker.service";
import {
    ingressFromLabels,
    platformRoleFromLabels,
    withIngress,
    withPlatformRole,
} from "@repo/nest-nodes/swarm-node-labels";
import { ClusterNodeRepository } from "@repo/nest-nodes/cluster-node.repository";
import { ClusterNodeInventoryRepository } from "@repo/nest-nodes/cluster-node-inventory.repository";
import { EnvService } from "@/config/env/env.module";

@Injectable()
export class ClusterService {
    private readonly logger = new Logger(ClusterService.name);

    constructor(
        private readonly swarmClusterService: SwarmClusterService,
        private readonly swarmFleetService: SwarmFleetService,
        private readonly participation: SwarmParticipationService,
        private readonly clusterNodeRepository: ClusterNodeRepository,
        private readonly inventoryRepository: ClusterNodeInventoryRepository,
        private readonly env: EnvService,
    ) {}

    /** Swarm participation read-model (mode/policy/engine state). */
    async getSwarmConfig(): Promise<SwarmConfigView> {
        return this.participation.view();
    }

    /** Persist + converge the participation config; returns the fresh view. */
    async setSwarmConfig(input: SwarmParticipationInput): Promise<SwarmConfigView> {
        return this.participation.applyConfig(input);
    }

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
     *
     * This is the PLATFORM master (the mesh election result persisted by
     * `SwarmLeadershipService`), not the Raft leader reported in the engine
     * snapshot. The staleness window uses the SAME env knobs as the election
     * watchdog, so the view can never disagree with the elector.
     */
    async getMaster(): Promise<ClusterMasterView> {
        const row = this.clusterNodeRepository.find();
        if (!row?.masterNodeId) {
            return null;
        }
        const heartbeatAt = row.lastHeartbeatAt ? Date.parse(row.lastHeartbeatAt) : 0;
        const ttlMs = this.env.get("SWARM_HEARTBEAT_TTL_MS");
        const graceMs = this.env.get("SWARM_MASTER_GRACE_MS");
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
     * (node.update Spec.Labels — SW-031) and persist to the local inventory.
     *
     * The LABELS are the durable record: the local inventory is a cache the
     * periodic sweep rebuilds from `docker node ls`, so the role must be
     * written onto the node — otherwise it is erased on the next sweep.
     */
    async updateNodeLabels(nodeId: string, input: {
        platformRole?: ClusterPlatformRole;
        ingress?: boolean;
    }): Promise<ClusterNode> {
        const before = await this.swarmClusterService.inspectSwarmNode(nodeId);

        await this.swarmClusterService.updateSwarmNodeLabels(
            nodeId,
            before.Version.Index,
            withIngress(
                withPlatformRole(before.Spec?.Labels ?? {}, input.platformRole ?? null),
                input.ingress ?? null,
            ),
        );

        // Re-read the ENGINE and answer from THAT — the node as it now IS, not as
        // it was asked to be. Deriving the response from the requested values
        // reported success for a label write the engine had not applied (and, via
        // `upsertFromEngine` below, poisoned the inventory cache with it until the
        // next sweep). The cache is now rebuilt from the same source the sweep
        // uses, so a partial write is visible immediately instead of being masked.
        const node = await this.swarmClusterService.inspectSwarmNode(nodeId);
        const labels = node.Spec?.Labels ?? {};
        const hostname = node.Description?.Hostname ?? "";
        const swarmRole = DockerService.resolveSwarmNodeRole(node);
        const platformRole = platformRoleFromLabels(labels);
        const isIngress = ingressFromLabels(labels);
        const isMaster = node.ManagerStatus?.Leader === true;
        const availability =
            node.Spec?.Availability === "pause" || node.Spec?.Availability === "drain"
                ? node.Spec.Availability
                : "active";
        const capacity = {
            nanoCpus: node.Description?.Resources?.NanoCPUs ?? null,
            memoryBytes: node.Description?.Resources?.MemoryBytes ?? null,
        };

        // Persist the engine's actual role/ingress into the local inventory (cache).
        this.inventoryRepository.upsertFromEngine({
            nodeId,
            hostname,
            swarmRole,
            platformRole,
            isLeader: isMaster,
            isIngress,
            availability,
            nanoCpus: capacity.nanoCpus,
            memoryBytes: capacity.memoryBytes,
            labels,
        });

        return {
            nodeId,
            hostname,
            swarmRole,
            platformRole,
            isMaster,
            isIngress,
            availability,
            capacity,
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