/**
 * ClusterService — platform-facing facade over the Swarm cluster (SW-003).
 * Implements the data needs of the `cluster` ORPC contract using the
 * swarm core services (bootstrap/snapshot, election, inventory, placement).
 */

import { Context, Effect } from 'effect'
import { Observable } from 'rxjs'

import type {
    ClusterPlatformRole,
    ClusterSnapshot,
    ClusterNode,
    SwarmNodeResources,
    SwarmServiceRuntime,
    SwarmTaskRuntime,
    SwarmConfigView,
    SwarmParticipationInput,
} from '@deployer/contracts-entities'
import { resolveSwarmNodeRole } from '@deployer/docker'
import {
    runPromiseUnwrapped,
    runSyncUnwrapped,
    type RequirementsOf,
} from '@deployer/effect-core'
import { type ClusterMasterView } from '@deployer/fleet-contracts'
import { clusterNodeInventoryRowSchema } from '@deployer/fleet-contracts'
import type { ClusterNodesRow } from '@deployer/nest-schema/local'
import {
    ingressFromLabels,
    platformRoleFromLabels,
    withIngress,
    withPlatformRole,
} from '@deployer/node-state'

import { attempt, attemptSync } from '../../../core/effects'
import {
    ClusterEnvPort,
    ClusterNodeRepoPort,
    NodeInventoryPort,
    SwarmClusterPort,
    SwarmFleetPort,
    SwarmParticipationPort,
} from '../cluster.ports'

type NodeInventoryRow = ReturnType<typeof clusterNodeInventoryRowSchema.parse>

/**
 * Every call goes to a swarm service or a node repository, so a use case fails with whatever that
 * collaborator refused with (left as thrown; the `.effect()` boundary lets it through for the host to translate).
 *
 * Each member names the ports it yields; there is no combined record.
 */
export type ClusterServiceShape = {
    /** Swarm participation read-model (mode/policy/engine state). */
    readonly getSwarmConfig: () => Effect.Effect<
        SwarmConfigView,
        unknown,
        SwarmParticipationPort
    >
    /** Persist + converge the participation config; returns the fresh view. */
    readonly setSwarmConfig: (
        input: SwarmParticipationInput
    ) => Effect.Effect<SwarmConfigView, unknown, SwarmParticipationPort>
    /** Local engine's current Swarm snapshot (typed). */
    readonly getSnapshot: () => Effect.Effect<
        ClusterSnapshot,
        unknown,
        SwarmClusterPort
    >
    /** Observable stream of node resources at 10s intervals. */
    readonly nodeResourcesStream: (
        nodeId: string
    ) => Effect.Effect<Observable<SwarmNodeResources>, never, SwarmFleetPort>
    /**
     * Fleet inventory from the persisted `cluster_nodes` table (fast, no live engine call). Falls
     * back to a live sweep when the table is empty.
     */
    readonly listNodes: (
        includeDown: boolean
    ) => Effect.Effect<
        NodeInventoryRow[],
        unknown,
        NodeInventoryPort | SwarmClusterPort
    >
    /**
     * Current controlling-master view (elected node + term + heartbeat state).
     *
     * This is the PLATFORM master (the mesh election result persisted by `SwarmLeadership`),
     * not the Raft leader reported in the engine snapshot. The staleness window uses the SAME env
     * knobs as the election watchdog, so the view can never disagree with the elector.
     */
    readonly getMaster: () => Effect.Effect<
        ClusterMasterView,
        unknown,
        ClusterNodeRepoPort | ClusterEnvPort
    >
    /**
     * Update a node's platform role / ingress labels via the SDK (node.update Spec.Labels — SW-031)
     * and persist to the local inventory. The LABELS are the durable record: the local inventory is
     * a cache the periodic sweep rebuilds from `docker node ls`, so the role must be written onto the
     * node, or it is erased on the next sweep.
     */
    readonly updateNodeLabels: (
        nodeId: string,
        input: { platformRole?: ClusterPlatformRole; ingress?: boolean }
    ) => Effect.Effect<ClusterNode, unknown, SwarmClusterPort | NodeInventoryPort>
    /** Mesh-wide swarm services with mode + desired/running task counts. */
    readonly listServices: () => Effect.Effect<
        SwarmServiceRuntime[],
        unknown,
        SwarmFleetPort
    >
    /** Swarm tasks filtered by service and/or node. */
    readonly listTasks: (filter: {
        serviceId?: string
        nodeId?: string
    }) => Effect.Effect<SwarmTaskRuntime[], unknown, SwarmFleetPort>
    /** Per-node aggregation (swarm services/tasks + local engine artifacts). */
    readonly getNodeResources: (
        nodeId: string
    ) => Effect.Effect<SwarmNodeResources, unknown, SwarmFleetPort>
}

/** The inventory rows the local cache answers with. */
type InventoryRows = ClusterNodesRow[]

/** Tag and implementation together: the tag is the contract, `Live` the one implementation. */
export class ClusterService extends Context.Service<
    ClusterService,
    ClusterServiceShape
>()('fleet/ClusterService') {
    /** Every port is yielded when a method runs, so this is a class the module provides with `useClass`. */
    static readonly live = class ClusterServiceImpl implements ClusterServiceShape {
        getSwarmConfig(): ReturnType<ClusterServiceShape['getSwarmConfig']> {
            return Effect.gen(function* () {
                const participation = yield* SwarmParticipationPort
                return yield* participation.view()
            })
        }

        setSwarmConfig(
            input: SwarmParticipationInput
        ): ReturnType<ClusterServiceShape['setSwarmConfig']> {
            return Effect.gen(function* () {
                const participation = yield* SwarmParticipationPort
                return yield* participation.applyConfig(input)
            })
        }

        getSnapshot(): ReturnType<ClusterServiceShape['getSnapshot']> {
            return Effect.gen(function* () {
                const cluster = yield* SwarmClusterPort
                return yield* cluster.getLocalClusterSnapshot()
            })
        }

        nodeResourcesStream(
            nodeId: string
        ): ReturnType<ClusterServiceShape['nodeResourcesStream']> {
            return Effect.gen(function* () {
                const fleet = yield* SwarmFleetPort
                return new Observable<SwarmNodeResources>((subscriber) => {
                    const push = () => {
                        runPromiseUnwrapped(
                            fleet.getNodeResources(nodeId)
                        )
                            .then((resources) => {
                                subscriber.next(resources)
                            })
                            .catch((err: unknown) => {
                                Effect.runFork(
                                    Effect.logWarning(
                                        `Node resources stream error: ${String(err)}`
                                    )
                                )
                            })
                    }
                    push()
                    const timer = setInterval(push, 10_000)
                    return () => {
                        clearInterval(timer)
                    }
                })
            })
        }

        /** The persisted inventory, filtered to active nodes unless `includeDown` asks for all. */
        private inventoryRows(
            includeDown: boolean
        ): Effect.Effect<InventoryRows, unknown, NodeInventoryPort> {
            return Effect.gen(function* () {
                const inventory = yield* NodeInventoryPort
                const rows = runSyncUnwrapped(inventory.list())
                return includeDown
                    ? rows
                    : rows.filter((row) => row.state === 'active')
            })
        }

        listNodes(
            includeDown: boolean
        ): ReturnType<ClusterServiceShape['listNodes']> {
            return Effect.gen({ self: this }, function* () {
                let rows = yield* this.inventoryRows(includeDown)

                if (rows.length === 0) {
                    // Fallback: live engine sweep for fresh installs before the first inventory timer ticks.
                    const inventory = yield* NodeInventoryPort
                    const cluster = yield* SwarmClusterPort
                    yield* attempt(async () => {
                        runSyncUnwrapped(
                            inventory.upsertAllFromEngine(
                                await runPromiseUnwrapped(
                                    cluster.listSwarmNodes()
                                )
                            )
                        )
                    }).pipe(
                        Effect.catch((error: unknown) =>
                            Effect.logWarning(
                                `Fleet inventory fallback sweep failed: ${error instanceof Error ? error.message : String(error)}`
                            )
                        )
                    )
                    rows = yield* this.inventoryRows(includeDown)
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
                        })
                    )
                )
            })
        }

        getMaster(): ReturnType<ClusterServiceShape['getMaster']> {
            return Effect.gen(function* () {
                const clusterNode = yield* ClusterNodeRepoPort
                const env = yield* ClusterEnvPort
                return yield* attemptSync(() => {
                    const row = runSyncUnwrapped(clusterNode.find())
                    if (!row?.masterNodeId) {
                        return null
                    }
                    const heartbeatAt = row.lastHeartbeatAt
                        ? Date.parse(row.lastHeartbeatAt)
                        : 0
                    const ttlMs = env.get('SWARM_HEARTBEAT_TTL_MS')
                    const graceMs = env.get('SWARM_MASTER_GRACE_MS')
                    const stale =
                        heartbeatAt > 0 &&
                        Date.now() - heartbeatAt > ttlMs + graceMs
                    return {
                        nodeId: row.masterNodeId,
                        term: row.masterTerm,
                        electedAt: row.lastHeartbeatAt ?? '',
                        heartbeatAt: row.lastHeartbeatAt ?? '',
                        reason: 'elected' as const,
                        state: stale
                            ? ('suspect' as const)
                            : ('healthy' as const),
                    }
                })
            })
        }

        updateNodeLabels(
            nodeId: string,
            input: { platformRole?: ClusterPlatformRole; ingress?: boolean }
        ): ReturnType<ClusterServiceShape['updateNodeLabels']> {
            return Effect.gen(function* () {
                const cluster = yield* SwarmClusterPort
                const inventory = yield* NodeInventoryPort
                const before = yield* cluster.inspectSwarmNode(nodeId)

                yield* attempt(() =>
                    runPromiseUnwrapped(
                        cluster.updateSwarmNodeLabels(
                            nodeId,
                            before.Version.Index,
                            withIngress(
                                withPlatformRole(
                                    before.Spec.Labels,
                                    input.platformRole ?? null
                                ),
                                input.ingress ?? null
                            )
                        )
                    )
                )

                // Re-read the ENGINE and answer from THAT — the node as it now IS, not as it was asked to
                // be. Deriving the response from the requested values reported success for a label write
                // the engine had not applied (and poisoned the inventory cache with it until the next
                // sweep). The cache is rebuilt from the same source the sweep uses, so a partial write
                // is visible immediately instead of being masked.
                const node = yield* cluster.inspectSwarmNode(nodeId)
                const labels = node.Spec.Labels
                const hostname = node.Description.Hostname
                const swarmRole = resolveSwarmNodeRole(node)
                const platformRole = platformRoleFromLabels(labels)
                const isIngress = ingressFromLabels(labels)
                const isMaster = node.ManagerStatus?.Leader === true
                const availability =
                    node.Spec.Availability === 'pause' ||
                    node.Spec.Availability === 'drain'
                        ? node.Spec.Availability
                        : 'active'
                const capacity = {
                    nanoCpus: node.Description.Resources?.NanoCPUs ?? null,
                    memoryBytes:
                        node.Description.Resources?.MemoryBytes ?? null,
                }

                // CLUSTER-009: the engine's own node state, not just its availability (`down` from `disconnected`).
                const state: 'ready' | 'down' | 'unknown' =
                    node.Status.State === 'ready' ? 'ready' : 'down'

                // Persist the engine's actual role/ingress into the local inventory (cache).
                yield* attemptSync(() =>
                    runSyncUnwrapped(
                        inventory.upsertFromEngine({
                            nodeId,
                            hostname,
                            swarmRole,
                            platformRole,
                            isLeader: isMaster,
                            isIngress,
                            availability,
                            state,
                            nanoCpus: capacity.nanoCpus,
                            memoryBytes: capacity.memoryBytes,
                            labels,
                        })
                    )
                )

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
                }
            })
        }

        listServices(): ReturnType<ClusterServiceShape['listServices']> {
            return Effect.gen(function* () {
                const fleet = yield* SwarmFleetPort
                return yield* fleet.listServices()
            })
        }

        listTasks(
            filter: { serviceId?: string; nodeId?: string }
        ): ReturnType<ClusterServiceShape['listTasks']> {
            return Effect.gen(function* () {
                const fleet = yield* SwarmFleetPort
                return yield* fleet.listTasks(filter)
            })
        }

        getNodeResources(
            nodeId: string
        ): ReturnType<ClusterServiceShape['getNodeResources']> {
            return Effect.gen(function* () {
                const fleet = yield* SwarmFleetPort
                return yield* fleet.getNodeResources(nodeId)
            })
        }
    }
}
