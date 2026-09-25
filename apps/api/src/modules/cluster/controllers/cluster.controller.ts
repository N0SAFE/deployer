import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { clusterContract } from "@repo/api-contracts";
import { ClusterService } from "../services/cluster.service";
import { ClusterSwarmEventsService } from "../events/cluster-swarm-events.service";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";

@Controller()
export class ClusterController {
    constructor(
        private readonly clusterService: ClusterService,
        private readonly clusterEvents: ClusterSwarmEventsService,
    ) {}

    @Implement(clusterContract.getSnapshot)
    getSnapshot() {
        return implement(clusterContract.getSnapshot)
            .use(requireAuth())
            .handler(async () => this.clusterService.getSnapshot());
    }

    @Implement(clusterContract.streamSnapshot)
    streamSnapshot() {
        return implement(clusterContract.streamSnapshot)
            .use(requireAuth())
            .handler(() => this.clusterEvents.observeSnapshot());
    }

    @Implement(clusterContract.listNodes)
    listNodes() {
        return implement(clusterContract.listNodes)
            .use(requireAuth())
            .handler(async ({ input }) => this.clusterService.listNodes(input.includeDown ?? false));
    }

    @Implement(clusterContract.streamNodes)
    streamNodes() {
        return implement(clusterContract.streamNodes)
            .use(requireAuth())
            .handler(({ input }) => this.clusterEvents.observeNodes(input.includeDown ?? false));
    }

    @Implement(clusterContract.getMaster)
    getMaster() {
        return implement(clusterContract.getMaster)
            .use(requireAuth())
            .handler(async () => this.clusterService.getMaster());
    }

    @Implement(clusterContract.getSwarmConfig)
    getSwarmConfig() {
        return implement(clusterContract.getSwarmConfig)
            .use(requireAuth())
            .handler(async () => this.clusterService.getSwarmConfig());
    }

    @Implement(clusterContract.setSwarmConfig)
    setSwarmConfig() {
        return implement(clusterContract.setSwarmConfig)
            .use(requireAuth())
            .handler(async ({ input }) => this.clusterService.setSwarmConfig(input));
    }

    @Implement(clusterContract.streamMaster)
    streamMaster() {
        return implement(clusterContract.streamMaster)
            .use(requireAuth())
            .handler(() => this.clusterEvents.observeMaster());
    }

    @Implement(clusterContract.updateNode)
    updateNode() {
        return implement(clusterContract.updateNode)
            .use(requireAuth())
            .handler(async ({ input }) =>
                this.clusterService.updateNodeLabels(input.params.nodeId, {
                    platformRole: input.body?.platformRole,
                    ingress: input.body?.ingress,
                }),
            );
    }

    @Implement(clusterContract.listServices)
    listServices() {
        return implement(clusterContract.listServices)
            .use(requireAuth())
            .handler(async () => this.clusterService.listServices());
    }

    @Implement(clusterContract.streamServices)
    streamServices() {
        return implement(clusterContract.streamServices)
            .use(requireAuth())
            .handler(() => this.clusterEvents.observeServices());
    }

    @Implement(clusterContract.listTasks)
    listTasks() {
        return implement(clusterContract.listTasks)
            .use(requireAuth())
            .handler(async ({ input }) =>
                this.clusterService.listTasks({
                    serviceId: input.query?.serviceId,
                    nodeId: input.query?.nodeId,
                }),
            );
    }

    @Implement(clusterContract.streamTasks)
    streamTasks() {
        return implement(clusterContract.streamTasks)
            .use(requireAuth())
            .handler(({ input }) =>
                this.clusterEvents.observeTasks(input.query?.serviceId, input.query?.nodeId),
            );
    }

    @Implement(clusterContract.getNodeResources)
    getNodeResources() {
        return implement(clusterContract.getNodeResources)
            .use(requireAuth())
            .handler(async ({ input }) =>
                this.clusterService.getNodeResources(input.query.nodeId),
            );
    }

    @Implement(clusterContract.streamNodeResources)
    streamNodeResources() {
        return implement(clusterContract.streamNodeResources)
            .use(requireAuth())
            .handler(({ input }) => {
                // Node resources derives from the same swarm event stream
                // but needs per-node filtering — use the snapshot + fleet data
                return this.clusterService.nodeResourcesStream$(input.query.nodeId);
            });
    }
}