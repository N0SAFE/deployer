/**
 * SwarmClusterService — single-node AND multi-node cluster bootstrap + state.
 *
 * Everything here is dockerode SDK (no CLI). `ensureCluster` drives the
 * idempotent first-boot path (`swarm init` when inactive), and
 * `getLocalClusterSnapshot` produces the platform's typed view of the
 * local engine's Swarm state (see `entities/swarm/cluster.schema.ts`).
 *
 * The platform "master" term/ownership (mesh election, phase P4) builds on
 * top of this engine-derived snapshot later; until then, the Raft leader
 * (engine truth) is reported as the de-facto `isMaster`.
 */

import { Injectable, Logger } from "@nestjs/common";
import {
    clusterSnapshotSchema,
    type SwarmInitOptions,
    type ClusterSnapshot,
    type DockerodeNodeSummary,
    type DockerodeServiceSummary,
} from "@repo/contracts-entities";
import { ServiceUnavailableError, TimeoutError } from "@repo/errors";
import { DockerService } from "@/core/modules/docker/services/docker.service";

@Injectable()
export class SwarmClusterService {
    private readonly logger = new Logger(SwarmClusterService.name);

    private static readonly JOIN_WAIT_ATTEMPTS = 10;
    private static readonly JOIN_WAIT_INTERVAL_MS = 1_000;

    constructor(private readonly dockerService: DockerService) {}

    /**
     * Throws when the local engine is not part of an active Swarm cluster.
     * Used by executors (e.g. the swarm runtime runner) as a readiness gate.
     */
    async assertClusterReady(): Promise<void> {
        const info = await this.dockerService.getSwarmInfo();
        if (info.LocalNodeState !== "active") {
            throw new ServiceUnavailableError(
                `docker swarm on this node (state=${info.LocalNodeState})`,
            );
        }
    }

    /**
     * Idempotently ensure the local engine is part of a Swarm cluster,
     * initializing one when no cluster exists yet (`dockerode.swarmInit`).
     * When the engine reports `pending`, waits for the join to settle.
     */
    async ensureCluster(options: SwarmInitOptions): Promise<ClusterSnapshot> {
        const info = await this.dockerService.getSwarmInfo();
        if (info.LocalNodeState === "active") {
            return this.getLocalClusterSnapshot();
        }
        if (info.LocalNodeState === "pending") {
            return this.waitForPendingJoin(options);
        }
        if (info.LocalNodeState === "inactive" || info.LocalNodeState === "locked") {
            await this.dockerService.swarmInit(options);
            this.logger.log(
                `Initialized Swarm cluster (advertise=${options.AdvertiseAddr ?? "default"})`,
            );
            return this.getLocalClusterSnapshot();
        }
        throw new ServiceUnavailableError(
            `docker swarm on this node (state=${info.LocalNodeState})`,
        );
    }

    /**
     * Join an existing cluster (worker or manager) using a join token issued
     * by the controlling node. No CLI: `dockerode.swarmJoin`.
     */
    async joinCluster(options: { joinToken: string; remoteAddrs: string[] }): Promise<ClusterSnapshot> {
        await this.dockerService.swarmJoin({
            RemoteAddrs: options.remoteAddrs,
            JoinToken: options.joinToken,
        });
        return this.getLocalClusterSnapshot();
    }

    /**
     * Typed snapshot of the local Swarm cluster state, derived entirely from
     * engine probes (info + swarm inspect + node inventory). All raw engine
     * output is Zod-parsed inside `DockerService`.
     *
     * When the engine is NOT in an active cluster (`inactive`/`pending`/
     * `locked`), only the cheap `GET /info` probe runs — `swarmInspect` and
     * `node list` return HTTP 503 on non-manager nodes, so they are never
     * called here. The result carries `localNodeState` for callers to gate on.
     */
    async getLocalClusterSnapshot(): Promise<ClusterSnapshot> {
        const info = await this.dockerService.getSwarmInfo();

        if (info.LocalNodeState !== "active") {
            return clusterSnapshotSchema.parse({
                clusterId: null,
                clusterName: null,
                localNodeState: info.LocalNodeState,
                controlAvailable: info.ControlAvailable,
                nodeCount: 0,
                managerCount: 0,
                localNode: {
                    nodeId: info.NodeID.length > 0 ? info.NodeID : "unknown",
                    hostname: "",
                    swarmRole: "none",
                    platformRole: "both",
                    isMaster: false,
                    isIngress: false,
                    availability: "active",
                    capacity: { nanoCpus: null, memoryBytes: null },
                    labels: {},
                    lastHeartbeatAt: null,
                },
                master: null,
                membership: {
                    nodeId: info.NodeID.length > 0 ? info.NodeID : "unknown",
                    state: "down",
                    joinedAt: new Date().toISOString(),
                },
                joinTokens: null,
            });
        }

        const [inspect, nodes] = await Promise.all([
            this.dockerService.swarmInspect(),
            this.dockerService.listSwarmNodes(),
        ]);

        const localNode = this.buildLocalNode(info.NodeID, nodes);
        const leader = nodes.find((node) => node.ManagerStatus?.Leader === true) ?? null;
        const joinTokens = inspect.JoinTokens
            ? { worker: inspect.JoinTokens.Worker, manager: inspect.JoinTokens.Manager }
            : null;

        const snapshot = clusterSnapshotSchema.parse({
            clusterId: inspect.ID.length > 0 ? inspect.ID : null,
            clusterName: inspect.Spec?.Name ?? null,
            localNodeState: info.LocalNodeState,
            controlAvailable: info.ControlAvailable,
            nodeCount: info.Nodes,
            managerCount: info.Managers,
            localNode,
            master: leader
                ? {
                      nodeId: leader.ID,
                      term: 1,
                      electedAt: new Date().toISOString(),
                      heartbeatAt: new Date().toISOString(),
                      reason: "raft_leader",
                  }
                : {
                      nodeId: localNode.nodeId,
                      term: 1,
                      electedAt: new Date().toISOString(),
                      heartbeatAt: new Date().toISOString(),
                      reason: "single_node",
                  },
            membership: {
                nodeId: localNode.nodeId,
                state: "active",
                joinedAt: new Date().toISOString(),
            },
            joinTokens,
        });

        return snapshot;
    }

    /**
     * Join tokens for onboarding additional nodes (workers or managers).
     * Returns null when the local engine is not part of an active cluster.
     */
    async getJoinTokens(): Promise<{ worker: string; manager: string } | null> {
        const info = await this.dockerService.getSwarmInfo();
        if (info.LocalNodeState !== "active") {
            return null;
        }
        const inspect = await this.dockerService.swarmInspect();
        if (!inspect.JoinTokens) {
            return null;
        }
        return { worker: inspect.JoinTokens.Worker, manager: inspect.JoinTokens.Manager };
    }

    /**
     * Swarm services whose `deployer.deployment_id` label matches the given
     * deployment. Used by the startup reconciliation to adopt deployments
     * whose service survived a crash (SW-026).
     */
    async listSwarmServicesForDeployment(deploymentId: string): Promise<DockerodeServiceSummary[]> {
        const services = await this.dockerService.listSwarmServices();
        return services.filter(
            (service) => service.Spec.Labels["deployer.deployment_id"] === deploymentId,
        );
    }

    /** Pass-through to the engine's node inventory (used by the election). */
    async listSwarmNodes(): Promise<DockerodeNodeSummary[]> {
        return this.dockerService.listSwarmNodes();
    }

    /** Pass-through to the engine's node inspect (used by the cluster UI). */
    async inspectSwarmNode(nodeId: string): Promise<DockerodeNodeSummary> {
        return this.dockerService.inspectSwarmNode(nodeId);
    }

    /** Pass-through to the engine's node label update (SW-031). */
    async updateSwarmNodeLabels(
        nodeId: string,
        version: number,
        labels: Record<string, string>,
    ): Promise<void> {
        return this.dockerService.updateSwarmNodeLabels(nodeId, version, labels);
    }

    private buildLocalNode(
        nodeId: string,
        nodes: DockerodeNodeSummary[],
    ): ClusterSnapshot["localNode"] {
        const self = nodes.find((node) => node.ID === nodeId) ?? null;
        const swarmRole = self && self.Spec.Role !== "worker" ? "manager" : nodeId.length > 0 ? "worker" : "none";
        return {
            nodeId: nodeId.length > 0 ? nodeId : "unknown",
            hostname: self?.Description.Hostname ?? "",
            swarmRole,
            platformRole: "both",
            isMaster: self?.ManagerStatus?.Leader === true,
            isIngress: self?.Spec.Labels["deployer.ingress"] === "true",
            availability: self?.Spec.Availability === "pause" || self?.Spec.Availability === "drain"
                ? self.Spec.Availability
                : "active",
            capacity: {
                nanoCpus: self?.Description.Resources?.NanoCPUs ?? null,
                memoryBytes: self?.Description.Resources?.MemoryBytes ?? null,
            },
            labels: self?.Spec.Labels ?? {},
            lastHeartbeatAt: new Date().toISOString(),
        };
    }

    private async waitForPendingJoin(options: SwarmInitOptions): Promise<ClusterSnapshot> {
        for (let attempt = 1; attempt <= SwarmClusterService.JOIN_WAIT_ATTEMPTS; attempt++) {
            this.logger.log(`Waiting for Swarm cluster state to settle (attempt ${String(attempt)})`);
            if (attempt > 1) {
                await new Promise((resolve) => setTimeout(resolve, SwarmClusterService.JOIN_WAIT_INTERVAL_MS));
            }
            const info = await this.dockerService.getSwarmInfo();
            if (info.LocalNodeState === "active") {
                return this.getLocalClusterSnapshot();
            }
            if (info.LocalNodeState === "inactive") {
                await this.dockerService.swarmInit(options);
                return this.getLocalClusterSnapshot();
            }
        }
        throw new TimeoutError("waiting for Swarm cluster state to settle", SwarmClusterService.JOIN_WAIT_ATTEMPTS * SwarmClusterService.JOIN_WAIT_INTERVAL_MS);
    }
}