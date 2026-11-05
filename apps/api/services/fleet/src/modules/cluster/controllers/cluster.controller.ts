import { Controller } from '@nestjs/common'
import { Implement } from '@orpc/nest'
import { Effect } from 'effect'

import { clusterContract } from '@deployer/fleet-contracts'
import { inBoundary, procedure } from '@deployer/nest-effect'
import {
    requireAuth,
    requirePlatformRole,
} from '@deployer/shared/core/modules/auth/orpc/middlewares'
import { liveSnapshot } from '@deployer/shared/core/utils/live-snapshot.utils'

import { attemptSync } from '../../../core/effects'
import { ClusterEventsPort } from '../cluster.ports'
import {
    ClusterService,
    type ClusterServicePorts,
} from '../services/cluster.service'

/**
 * Re-evaluation cadence for `streamSwarmConfig` — the interval the dashboard used
 * to poll this query at. Participation converges over seconds, not milliseconds.
 */
const SWARM_CONFIG_STREAM_INTERVAL_MS = 15_000

/**
 * The cluster surface. Request/response procedures resolve `ClusterService` from the module's Effect
 * context; the `stream*` procedures hand back the RxJS observables of the event hub (reached through
 * `ClusterEventsPort`). Every use case runs through the `.effect()` boundary.
 */

/** Swarm membership and node labels are operational acts: a viewer keeps the reads. */
const CLUSTER_OPERATOR_ROLES = ['superAdmin', 'admin', 'operator']

@Controller()
export class ClusterController {
    @Implement(clusterContract.getSnapshot)
    getSnapshot() {
        return procedure(clusterContract.getSnapshot)
            .use(requireAuth())
            .effect(function* () {
                const cluster = yield* ClusterService
                return yield* cluster.getSnapshot()
            })
    }

    @Implement(clusterContract.streamSnapshot)
    streamSnapshot() {
        return procedure(clusterContract.streamSnapshot)
            .use(requireAuth())
            .effect(function* () {
                const events = yield* ClusterEventsPort
                return yield* attemptSync(() => events.observeSnapshot())
            })
    }

    @Implement(clusterContract.listNodes)
    listNodes() {
        return procedure(clusterContract.listNodes)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const cluster = yield* ClusterService
                return yield* cluster.listNodes(input.includeDown ?? false)
            })
    }

    @Implement(clusterContract.streamNodes)
    streamNodes() {
        return procedure(clusterContract.streamNodes)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const events = yield* ClusterEventsPort
                return yield* attemptSync(() =>
                    events.observeNodes(input.includeDown ?? false)
                )
            })
    }

    @Implement(clusterContract.getMaster)
    getMaster() {
        return procedure(clusterContract.getMaster)
            .use(requireAuth())
            .effect(function* () {
                const cluster = yield* ClusterService
                return yield* cluster.getMaster()
            })
    }

    @Implement(clusterContract.getSwarmConfig)
    getSwarmConfig() {
        return procedure(clusterContract.getSwarmConfig)
            .use(requireAuth())
            .effect(function* () {
                const cluster = yield* ClusterService
                return yield* cluster.getSwarmConfig()
            })
    }

    @Implement(clusterContract.streamSwarmConfig)
    streamSwarmConfig() {
        return procedure(clusterContract.streamSwarmConfig)
            .use(requireAuth())
            .effect(function* ({ context }) {
                const cluster = yield* ClusterService
                const ports = yield* Effect.context<ClusterServicePorts>()
                // A poll runs on a timer, outside the request fiber: it re-enters the request boundary so it has the actor like any request.
                return liveSnapshot(
                    () =>
                        Effect.runPromise(
                            inBoundary(
                                context,
                                cluster
                                    .getSwarmConfig()
                                    .pipe(Effect.provideContext(ports))
                            )
                        ),
                    {
                        intervalMs: SWARM_CONFIG_STREAM_INTERVAL_MS,
                    }
                )
            })
    }

    @Implement(clusterContract.setSwarmConfig)
    setSwarmConfig() {
        return procedure(clusterContract.setSwarmConfig)
            .use(requireAuth())
            .use(requirePlatformRole(CLUSTER_OPERATOR_ROLES))
            .effect(function* ({ input }) {
                const cluster = yield* ClusterService
                return yield* cluster.setSwarmConfig(input)
            })
    }

    @Implement(clusterContract.streamMaster)
    streamMaster() {
        return procedure(clusterContract.streamMaster)
            .use(requireAuth())
            .effect(function* () {
                const events = yield* ClusterEventsPort
                return yield* attemptSync(() => events.observeMaster())
            })
    }

    @Implement(clusterContract.updateNode)
    updateNode() {
        return procedure(clusterContract.updateNode)
            .use(requireAuth())
            .use(requirePlatformRole(CLUSTER_OPERATOR_ROLES))
            .effect(function* ({ input }) {
                const cluster = yield* ClusterService
                return yield* cluster.updateNodeLabels(input.params.nodeId, {
                    platformRole: input.body?.platformRole,
                    ingress: input.body?.ingress,
                })
            })
    }

    @Implement(clusterContract.listServices)
    listServices() {
        return procedure(clusterContract.listServices)
            .use(requireAuth())
            .effect(function* () {
                const cluster = yield* ClusterService
                return yield* cluster.listServices()
            })
    }

    @Implement(clusterContract.streamServices)
    streamServices() {
        return procedure(clusterContract.streamServices)
            .use(requireAuth())
            .effect(function* () {
                const events = yield* ClusterEventsPort
                return yield* attemptSync(() => events.observeServices())
            })
    }

    @Implement(clusterContract.listTasks)
    listTasks() {
        return procedure(clusterContract.listTasks)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const cluster = yield* ClusterService
                return yield* cluster.listTasks({
                    serviceId: input.query?.serviceId,
                    nodeId: input.query?.nodeId,
                })
            })
    }

    @Implement(clusterContract.streamTasks)
    streamTasks() {
        return procedure(clusterContract.streamTasks)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const events = yield* ClusterEventsPort
                return yield* attemptSync(() =>
                    events.observeTasks(
                        input.query?.serviceId,
                        input.query?.nodeId
                    )
                )
            })
    }

    @Implement(clusterContract.getNodeResources)
    getNodeResources() {
        return procedure(clusterContract.getNodeResources)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const cluster = yield* ClusterService
                return yield* cluster.getNodeResources(input.query.nodeId)
            })
    }

    @Implement(clusterContract.streamNodeResources)
    streamNodeResources() {
        return procedure(clusterContract.streamNodeResources)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const cluster = yield* ClusterService
                return yield* cluster.nodeResourcesStream(input.query.nodeId)
            })
    }
}
