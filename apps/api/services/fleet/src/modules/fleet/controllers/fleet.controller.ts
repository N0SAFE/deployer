import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { nodesContract } from "@repo/api-contracts";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";
import { FleetService } from "../services/fleet.service";

/**
 * Fleet Controller — implements the `nodes.*` ORPC contract.
 * Backed by the cluster fleet tables (cluster_nodes, allocations,
 * admission requests).
 *
 * NOTE: the contract must be referenced through `nodesContract.*`
 * so the `/nodes` router prefix is preserved in the mapped Nest routes.
 */
@Controller()
export class FleetController {
    constructor(private readonly fleetService: FleetService) {}

    @Implement(nodesContract.listServers)
    listServers() {
        return implement(nodesContract.listServers)
            .use(requireAuth())
            .handler(async () => {
                return this.fleetService.listServers();
            });
    }

    @Implement(nodesContract.setServerCapacity)
    setServerCapacity() {
        return implement(nodesContract.setServerCapacity)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const result = await this.fleetService.setServerCapacity(input);
                return { status: 201 as const, body: result };
            });
    }

    @Implement(nodesContract.listAllocations)
    listAllocations() {
        return implement(nodesContract.listAllocations)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.fleetService.listAllocations(input.query ?? {});
            });
    }

    @Implement(nodesContract.listMyAllocations)
    listMyAllocations() {
        return implement(nodesContract.listMyAllocations)
            .use(requireAuth())
            .handler(async () => {
                return this.fleetService.listMyAllocations();
            });
    }

    @Implement(nodesContract.checkMyAdmission)
    checkMyAdmission() {
        return implement(nodesContract.checkMyAdmission)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const result = await this.fleetService.checkMyAdmission(context.auth.user.id, input);
                return { status: 201 as const, headers: {}, body: result };
            });
    }

    @Implement(nodesContract.createMyAdmissionRequest)
    createMyAdmissionRequest() {
        return implement(nodesContract.createMyAdmissionRequest)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const result = await this.fleetService.createMyAdmissionRequest(context.auth.user.id, input);
                return { status: 201 as const, headers: {}, body: result };
            });
    }

    @Implement(nodesContract.listMyAdmissionRequests)
    listMyAdmissionRequests() {
        return implement(nodesContract.listMyAdmissionRequests)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                return this.fleetService.listMyAdmissionRequests(context.auth.user.id, input.query ?? {});
            });
    }

    @Implement(nodesContract.upsertAllocation)
    upsertAllocation() {
        return implement(nodesContract.upsertAllocation)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const result = await this.fleetService.upsertAllocation(input);
                return { status: 201 as const, headers: {}, body: result };
            });
    }

    @Implement(nodesContract.deleteAllocation)
    deleteAllocation() {
        return implement(nodesContract.deleteAllocation)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const result = await this.fleetService.deleteAllocation(input);
                return { status: 201 as const, headers: {}, body: result };
            });
    }

    @Implement(nodesContract.listAdmissionRequests)
    listAdmissionRequests() {
        return implement(nodesContract.listAdmissionRequests)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.fleetService.listAdmissionRequests(input.query ?? {});
            });
    }

    @Implement(nodesContract.resolveAdmissionRequest)
    resolveAdmissionRequest() {
        return implement(nodesContract.resolveAdmissionRequest)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const result = await this.fleetService.resolveAdmissionRequest(input);
                return { status: 201 as const, headers: {}, body: result };
            });
    }
}
