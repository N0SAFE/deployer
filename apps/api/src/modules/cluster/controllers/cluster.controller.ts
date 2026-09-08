import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { clusterContract } from "@repo/api-contracts";
import { ClusterService } from "../services/cluster.service";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";

@Controller()
export class ClusterController {
    constructor(private readonly clusterService: ClusterService) {}

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
            .handler(() => {
                return this.clusterService.snapshotStream$();
            });
    }

    @Implement(clusterContract.listNodes)
    listNodes() {
        return implement(clusterContract.listNodes)
            .use(requireAuth())
            .handler(async ({ input }) => this.clusterService.listNodes(input.includeDown ?? false));
    }

    @Implement(clusterContract.getMaster)
    getMaster() {
        return implement(clusterContract.getMaster)
            .use(requireAuth())
            .handler(async () => this.clusterService.getMaster());
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
                return this.clusterService.nodeResourcesStream$(input.query.nodeId);
            });
    }
}