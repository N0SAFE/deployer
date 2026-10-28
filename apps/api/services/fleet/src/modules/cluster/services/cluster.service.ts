/**
 * ClusterService — platform-facing facade over the Swarm cluster (SW-003).
 * Implements the data needs of the `cluster` ORPC contract using the
 * swarm core services (bootstrap/snapshot, election, inventory, placement).
 */

import { Context, Effect, Layer } from "effect";
import { Observable } from "rxjs";

import { attempt, attemptSync } from "../../../core/effects";
import {
    ClusterEnvPort,
    ClusterNodeRepoPort,
    NodeInventoryPort,
    SwarmClusterPort,
    SwarmFleetPort,
    SwarmParticipationPort,
} from "../cluster.ports";
import type { ClusterPlatformRole, ClusterSnapshot, ClusterNode, SwarmNodeResources, SwarmServiceRuntime, SwarmTaskRuntime, SwarmConfigView, SwarmParticipationInput } from "@deployer/contracts-entities";
import { clusterNodeInventoryRowSchema } from "@deployer/fleet-contracts";
import { type ClusterMasterView } from "@deployer/fleet-contracts";
import { resolveSwarmNodeRole } from "@deployer/docker";
import type { SwarmClusterService, SwarmFleetService, SwarmParticipationService } from "@deployer/nest-swarm";
import type { ClusterNodeInventoryRepository } from "@deployer/nest-nodes/cluster-node-inventory.repository";
import type { ClusterNodeRepository } from "@deployer/nest-nodes/cluster-node.repository";
import type { EnvService } from "@deployer/shared/config/env/env.module";
import {
    ingressFromLabels,
    platformRoleFromLabels,
    withIngress,
    withPlatformRole,
} from "@deployer/nest-nodes/swarm-node-labels";


type Ports = {
    readonly swarmClusterService: SwarmClusterService;
    readonly swarmFleetService: SwarmFleetService;
    readonly participation: SwarmParticipationService;
    readonly clusterNodeRepository: ClusterNodeRepository;
    readonly inventoryRepository: ClusterNodeInventoryRepository;
    readonly env: EnvService;
};

type NodeInventoryRow = ReturnType<typeof clusterNodeInventoryRowSchema.parse>;

/**
 * Every call goes to a swarm service or a node repository, so a use case fails with whatever that
 * collaborator refused with (left as thrown; `serve` lets it through for the host to translate).
 */
export type ClusterServiceShape = {
    /** Swarm participation read-model (mode/policy/engine state). */
    readonly getSwarmConfig: () => Effect.Effect<SwarmConfigView, unknown>;
    /** Persist + converge the participation config; returns the fresh view. */
    readonly setSwarmConfig: (input: SwarmParticipationInput) => Effect.Effect<SwarmConfigView, unknown>;
    /** Local engine's current Swarm snapshot (typed). */
    readonly getSnapshot: () => Effect.Effect<ClusterSnapshot, unknown>;
    /** Observable stream of node resources at 10s intervals. */
    readonly nodeResourcesStream: (nodeId: string) => Effect.Effect<Observable<SwarmNodeResources>>;
    /**
     * Fleet inventory from the persisted `cluster_nodes` table (fast, no live engine call). Falls
     * back to a live sweep when the table is empty.
     */
    readonly listNodes: (includeDown: boolean) => Effect.Effect<NodeInventoryRow[], unknown>;
    /**
     * Current controlling-master view (elected node + term + heartbeat state).
     *
     * This is the PLATFORM master (the mesh election result persisted by `SwarmLeadershipService`),
     * not the Raft leader reported in the engine snapshot. The staleness window uses the SAME env
     * knobs as the election watchdog, so the view can never disagree with the elector.
     */
    readonly getMaster: () => Effect.Effect<ClusterMasterView, unknown>;
    /**
     * Update a node's platform role / ingress labels via the SDK (node.update Spec.Labels — SW-031)
     * and persist to the local inventory. The LABELS are the durable record: the local inventory is
     * a cache the periodic sweep rebuilds from `docker node ls`, so the role must be written onto the
     * node, or it is erased on the next sweep.
     */
    readonly updateNodeLabels: (
        nodeId: string,
        input: { platformRole?: ClusterPlatformRole; ingress?: boolean },
    ) => Effect.Effect<ClusterNode, unknown>;
    /** Mesh-wide swarm services with mode + desired/running task counts. */
    readonly listServices: () => Effect.Effect<SwarmServiceRuntime[], unknown>;
    /** Swarm tasks filtered by service and/or node. */
    readonly listTasks: (filter: { serviceId?: string; nodeId?: string }) => Effect.Effect<SwarmTaskRuntime[], unknown>;
    /** Per-node aggregation (swarm services/tasks + local engine artifacts). */
    readonly getNodeResources: (nodeId: string) => Effect.Effect<SwarmNodeResources, unknown>;
};

/** Tag and implementation together: the tag is the contract, `Live` the one implementation. */
export class ClusterService extends Context.Service<ClusterService, ClusterServiceShape>()("fleet/ClusterService") {
    static readonly Live: Layer.Layer<
        ClusterService,
        never,
        SwarmClusterPort | SwarmFleetPort | SwarmParticipationPort | ClusterNodeRepoPort | NodeInventoryPort | ClusterEnvPort
    > = Layer.effect(
        ClusterService,
        Effect.gen(function* () {
            return makeClusterService({
                swarmClusterService: yield* SwarmClusterPort,
                swarmFleetService: yield* SwarmFleetPort,
                participation: yield* SwarmParticipationPort,
                clusterNodeRepository: yield* ClusterNodeRepoPort,
                inventoryRepository: yield* NodeInventoryPort,
                env: yield* ClusterEnvPort,
            });
        }),
    );
}

export function makeClusterService(ports: Ports): ClusterServiceShape {
    const { swarmClusterService, swarmFleetService, participation, clusterNodeRepository, inventoryRepository, env } = ports;

    const toInventoryRows = (includeDown: boolean) =>
        attemptSync(() => {
            const rows = inventoryRepository.list();
            return includeDown ? rows : rows.filter((row) => row.state === "active");
        });

    return {
        getSwarmConfig: () => attempt(() => participation.view()),

        setSwarmConfig: (input) => attempt(() => participation.applyConfig(input)),

        getSnapshot: () => attempt(() => swarmClusterService.getLocalClusterSnapshot()),

        nodeResourcesStream: (nodeId) =>
            Effect.sync(
                () =>
                    new Observable<SwarmNodeResources>((subscriber) => {
                        const push = () => {
                            swarmFleetService
                                .getNodeResources(nodeId)
                                .then((resources) => {
                                    subscriber.next(resources);
                                })
                                .catch((err: unknown) => {
                                    Effect.runFork(Effect.logWarning(`Node resources stream error: ${String(err)}`));
                                });
                        };
                        push();
                        const timer = setInterval(push, 10_000);
                        return () => {
                            clearInterval(timer);
                        };
                    }),
            ),

        listNodes: Effect.fn("ClusterService.listNodes")(function* (includeDown) {
            let rows = yield* toInventoryRows(includeDown);

            if (rows.length === 0) {
                // Fallback: live engine sweep for fresh installs before the first inventory timer ticks.
                yield* attempt(async () => {
                    inventoryRepository.upsertAllFromEngine(await swarmClusterService.listSwarmNodes());
                }).pipe(
                    Effect.catch((error: unknown) =>
                        Effect.logWarning(
                            `Fleet inventory fallback sweep failed: ${error instanceof Error ? error.message : String(error)}`,
                        ),
                    ),
                );
                rows = yield* toInventoryRows(includeDown);
            }

            return yield* attemptSync(() =>
                rows.map((row) =>
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
                ),
            );
        }),

        getMaster: () =>
            attemptSync(() => {
                const row = clusterNodeRepository.find();
                if (!row?.masterNodeId) {
                    return null;
                }
                const heartbeatAt = row.lastHeartbeatAt ? Date.parse(row.lastHeartbeatAt) : 0;
                const ttlMs = env.get("SWARM_HEARTBEAT_TTL_MS");
                const graceMs = env.get("SWARM_MASTER_GRACE_MS");
                const stale = heartbeatAt > 0 && Date.now() - heartbeatAt > ttlMs + graceMs;
                return {
                    nodeId: row.masterNodeId,
                    term: row.masterTerm,
                    electedAt: row.lastHeartbeatAt ?? "",
                    heartbeatAt: row.lastHeartbeatAt ?? "",
                    reason: "elected" as const,
                    state: stale ? ("suspect" as const) : ("healthy" as const),
                };
            }),

        updateNodeLabels: Effect.fn("ClusterService.updateNodeLabels")(function* (nodeId, input) {
            const before = yield* attempt(() => swarmClusterService.inspectSwarmNode(nodeId));

            yield* attempt(() =>
                swarmClusterService.updateSwarmNodeLabels(
                    nodeId,
                    before.Version.Index,
                    withIngress(
                        withPlatformRole(before.Spec?.Labels ?? {}, input.platformRole ?? null),
                        input.ingress ?? null,
                    ),
                ),
            );

            // Re-read the ENGINE and answer from THAT — the node as it now IS, not as it was asked to
            // be. Deriving the response from the requested values reported success for a label write
            // the engine had not applied (and poisoned the inventory cache with it until the next
            // sweep). The cache is rebuilt from the same source the sweep uses, so a partial write
            // is visible immediately instead of being masked.
            const node = yield* attempt(() => swarmClusterService.inspectSwarmNode(nodeId));
            const labels = node.Spec?.Labels ?? {};
            const hostname = node.Description?.Hostname ?? "";
            const swarmRole = resolveSwarmNodeRole(node);
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
            yield* attemptSync(() =>
                inventoryRepository.upsertFromEngine({
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
                }),
            );

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
        }),

        listServices: () => attempt(() => swarmFleetService.listServices()),

        listTasks: (filter) => attempt(() => swarmFleetService.listTasks(filter)),

        getNodeResources: (nodeId) => attempt(() => swarmFleetService.getNodeResources(nodeId)),
    };
}
