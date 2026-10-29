import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { clusterContract } from "@deployer/fleet-contracts";
import { EffectContextOf } from "@deployer/nest-effect";
import { requireAuth } from "@deployer/shared/core/modules/auth/orpc/middlewares";
import { liveSnapshot } from "@deployer/shared/core/utils/live-snapshot.utils";
import { Effect } from "effect";

import { attemptSync } from "../../../core/effects";
import { serve } from "../../../core/orpc/serve";
import { ClusterModule } from "../cluster.module";
import { ClusterEventsPort } from "../cluster.ports";
import { ClusterService, type ClusterServicePorts } from "../services/cluster.service";

/**
 * Re-evaluation cadence for `streamSwarmConfig` — the interval the dashboard used
 * to poll this query at. Participation converges over seconds, not milliseconds.
 */
const SWARM_CONFIG_STREAM_INTERVAL_MS = 15_000;

/**
 * The cluster surface. Request/response procedures resolve `ClusterService` from the module's Effect
 * context; the `stream*` procedures hand back the RxJS observables of the event hub (reached through
 * `ClusterEventsPort`). Every use case runs through `serve`.
 */
@Controller()
export class ClusterController {
    @Implement(clusterContract.getSnapshot)
    getSnapshot() {
        return implement(clusterContract.getSnapshot)
            .use(requireAuth())
            .use(ClusterModule[EffectContextOf])
            .effect(function* ({ context }) {
                const cluster = yield* ClusterService;
                return yield* serve(context)(cluster.getSnapshot());
            });
    }

    @Implement(clusterContract.streamSnapshot)
    streamSnapshot() {
        return implement(clusterContract.streamSnapshot)
            .use(requireAuth())
            .use(ClusterModule[EffectContextOf])
            .effect(function* ({ context }) {
                const events = yield* ClusterEventsPort;
                return yield* serve(context)(attemptSync(() => events.observeSnapshot()));
            });
    }

    @Implement(clusterContract.listNodes)
    listNodes() {
        return implement(clusterContract.listNodes)
            .use(requireAuth())
            .use(ClusterModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const cluster = yield* ClusterService;
                return yield* serve(context)(cluster.listNodes(input.includeDown ?? false));
            });
    }

    @Implement(clusterContract.streamNodes)
    streamNodes() {
        return implement(clusterContract.streamNodes)
            .use(requireAuth())
            .use(ClusterModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const events = yield* ClusterEventsPort;
                return yield* serve(context)(attemptSync(() => events.observeNodes(input.includeDown ?? false)));
            });
    }

    @Implement(clusterContract.getMaster)
    getMaster() {
        return implement(clusterContract.getMaster)
            .use(requireAuth())
            .use(ClusterModule[EffectContextOf])
            .effect(function* ({ context }) {
                const cluster = yield* ClusterService;
                return yield* serve(context)(cluster.getMaster());
            });
    }

    @Implement(clusterContract.getSwarmConfig)
    getSwarmConfig() {
        return implement(clusterContract.getSwarmConfig)
            .use(requireAuth())
            .use(ClusterModule[EffectContextOf])
            .effect(function* ({ context }) {
                const cluster = yield* ClusterService;
                return yield* serve(context)(cluster.getSwarmConfig());
            });
    }

    @Implement(clusterContract.streamSwarmConfig)
    streamSwarmConfig() {
        return implement(clusterContract.streamSwarmConfig)
            .use(requireAuth())
            .use(ClusterModule[EffectContextOf])
            .effect(function* ({ context }) {
                const cluster = yield* ClusterService;
                const ports = yield* Effect.context<ClusterServicePorts>();
                // Each evaluation runs through `serve`, so a poll provides the actor like any request.
                return liveSnapshot(() => Effect.runPromise(serve(context)(cluster.getSwarmConfig().pipe(Effect.provideContext(ports)))), {
                    intervalMs: SWARM_CONFIG_STREAM_INTERVAL_MS,
                });
            });
    }

    @Implement(clusterContract.setSwarmConfig)
    setSwarmConfig() {
        return implement(clusterContract.setSwarmConfig)
            .use(requireAuth())
            .use(ClusterModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const cluster = yield* ClusterService;
                return yield* serve(context)(cluster.setSwarmConfig(input));
            });
    }

    @Implement(clusterContract.streamMaster)
    streamMaster() {
        return implement(clusterContract.streamMaster)
            .use(requireAuth())
            .use(ClusterModule[EffectContextOf])
            .effect(function* ({ context }) {
                const events = yield* ClusterEventsPort;
                return yield* serve(context)(attemptSync(() => events.observeMaster()));
            });
    }

    @Implement(clusterContract.updateNode)
    updateNode() {
        return implement(clusterContract.updateNode)
            .use(requireAuth())
            .use(ClusterModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const cluster = yield* ClusterService;
                return yield* serve(context)(cluster.updateNodeLabels(input.params.nodeId, {
                        platformRole: input.body?.platformRole,
                        ingress: input.body?.ingress,
                    }));
            });
    }

    @Implement(clusterContract.listServices)
    listServices() {
        return implement(clusterContract.listServices)
            .use(requireAuth())
            .use(ClusterModule[EffectContextOf])
            .effect(function* ({ context }) {
                const cluster = yield* ClusterService;
                return yield* serve(context)(cluster.listServices());
            });
    }

    @Implement(clusterContract.streamServices)
    streamServices() {
        return implement(clusterContract.streamServices)
            .use(requireAuth())
            .use(ClusterModule[EffectContextOf])
            .effect(function* ({ context }) {
                const events = yield* ClusterEventsPort;
                return yield* serve(context)(attemptSync(() => events.observeServices()));
            });
    }

    @Implement(clusterContract.listTasks)
    listTasks() {
        return implement(clusterContract.listTasks)
            .use(requireAuth())
            .use(ClusterModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const cluster = yield* ClusterService;
                return yield* serve(context)(cluster.listTasks({
                        serviceId: input.query?.serviceId,
                        nodeId: input.query?.nodeId,
                    }));
            });
    }

    @Implement(clusterContract.streamTasks)
    streamTasks() {
        return implement(clusterContract.streamTasks)
            .use(requireAuth())
            .use(ClusterModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const events = yield* ClusterEventsPort;
                return yield* serve(context)(attemptSync(() => events.observeTasks(input.query?.serviceId, input.query?.nodeId)));
            });
    }

    @Implement(clusterContract.getNodeResources)
    getNodeResources() {
        return implement(clusterContract.getNodeResources)
            .use(requireAuth())
            .use(ClusterModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const cluster = yield* ClusterService;
                return yield* serve(context)(cluster.getNodeResources(input.query.nodeId));
            });
    }

    @Implement(clusterContract.streamNodeResources)
    streamNodeResources() {
        return implement(clusterContract.streamNodeResources)
            .use(requireAuth())
            .use(ClusterModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const cluster = yield* ClusterService;
                return yield* serve(context)(cluster.nodeResourcesStream(input.query.nodeId));
            });
    }
}
