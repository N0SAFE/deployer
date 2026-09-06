import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { appContract } from "@repo/api-contracts";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";
import { FleetService } from "../services/fleet.service";

/**
 * Fleet Controller — implements the `nodes.*` ORPC contract.
 * Backed by the cluster fleet tables (cluster_nodes, allocations,
 * admission requests).
 *
 * NOTE: the contract must be referenced through `appContract.nodes.*`
 * so the `/nodes` router prefix is preserved in the mapped Nest routes.
 */
@Controller()
export class FleetController {
    constructor(private readonly fleetService: FleetService) {}

    @Implement(appContract.nodes.listServers)
    listServers() {
        return implement(appContract.nodes.listServers)
            .use(requireAuth())
            .handler(async () => {
                return this.fleetService.listServers();
            });
    }

    @Implement(appContract.nodes.setServerCapacity)
    setServerCapacity() {
        return implement(appContract.nodes.setServerCapacity)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const result = await this.fleetService.setServerCapacity(input);
                return { status: 201 as const, body: result };
            });
    }

    @Implement(appContract.nodes.listAllocations)
    listAllocations() {
        return implement(appContract.nodes.listAllocations)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.fleetService.listAllocations(input.query ?? {});
            });
    }

    @Implement(appContract.nodes.listMyAllocations)
    listMyAllocations() {
        return implement(appContract.nodes.listMyAllocations)
            .use(requireAuth())
            .handler(async () => {
                return this.fleetService.listMyAllocations();
            });
    }

    @Implement(appContract.nodes.checkMyAdmission)
    checkMyAdmission() {
        return implement(appContract.nodes.checkMyAdmission)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const result = await this.fleetService.checkMyAdmission(context.auth.user.id, input);
                return { status: 201 as const, headers: {}, body: result };
            });
    }

    @Implement(appContract.nodes.createMyAdmissionRequest)
    createMyAdmissionRequest() {
        return implement(appContract.nodes.createMyAdmissionRequest)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const result = await this.fleetService.createMyAdmissionRequest(context.auth.user.id, input);
                return { status: 201 as const, headers: {}, body: result };
            });
    }

    @Implement(appContract.nodes.listMyAdmissionRequests)
    listMyAdmissionRequests() {
        return implement(appContract.nodes.listMyAdmissionRequests)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                return this.fleetService.listMyAdmissionRequests(context.auth.user.id, input.query ?? {});
            });
    }

    @Implement(appContract.nodes.upsertAllocation)
    upsertAllocation() {
        return implement(appContract.nodes.upsertAllocation)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const result = await this.fleetService.upsertAllocation(input);
                return { status: 201 as const, headers: {}, body: result };
            });
    }

    @Implement(appContract.nodes.deleteAllocation)
    deleteAllocation() {
        return implement(appContract.nodes.deleteAllocation)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const result = await this.fleetService.deleteAllocation(input);
                return { status: 201 as const, headers: {}, body: result };
            });
    }

    @Implement(appContract.nodes.listAdmissionRequests)
    listAdmissionRequests() {
        return implement(appContract.nodes.listAdmissionRequests)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.fleetService.listAdmissionRequests(input.query ?? {});
            });
    }

    @Implement(appContract.nodes.resolveAdmissionRequest)
    resolveAdmissionRequest() {
        return implement(appContract.nodes.resolveAdmissionRequest)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const result = await this.fleetService.resolveAdmissionRequest(input);
                return { status: 201 as const, headers: {}, body: result };
            });
    }
}
