import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { appContract } from "@repo/api-contracts";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";
import { FleetService } from "../services/fleet.service";

/**
 * Fleet Controller — implements the `core.fleet.*` ORPC contract.
 * Backed by the cluster fleet tables (cluster_nodes, allocations,
 * admission requests).
 *
 * NOTE: the contract must be referenced through `appContract.core.fleet.*`
 * (not the standalone `fleetContract`) so the `/core` router prefix is
 * preserved in the mapped Nest routes.
 */
@Controller()
export class FleetController {
    constructor(private readonly fleetService: FleetService) {}

    @Implement(appContract.core.fleet.listServers)
    listServers() {
        return implement(appContract.core.fleet.listServers)
            .use(requireAuth())
            .handler(async () => {
                return this.fleetService.listServers();
            });
    }

    @Implement(appContract.core.fleet.setServerCapacity)
    setServerCapacity() {
        return implement(appContract.core.fleet.setServerCapacity)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const result = await this.fleetService.setServerCapacity(input);
                return { status: 201 as const, body: result };
            });
    }

    @Implement(appContract.core.fleet.listAllocations)
    listAllocations() {
        return implement(appContract.core.fleet.listAllocations)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.fleetService.listAllocations(input.query ?? {});
            });
    }

    @Implement(appContract.core.fleet.listMyAllocations)
    listMyAllocations() {
        return implement(appContract.core.fleet.listMyAllocations)
            .use(requireAuth())
            .handler(async () => {
                return this.fleetService.listMyAllocations();
            });
    }

    @Implement(appContract.core.fleet.checkMyAdmission)
    checkMyAdmission() {
        return implement(appContract.core.fleet.checkMyAdmission)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const result = await this.fleetService.checkMyAdmission(context.auth.user.id, input);
                return { status: 201 as const, headers: {}, body: result };
            });
    }

    @Implement(appContract.core.fleet.createMyAdmissionRequest)
    createMyAdmissionRequest() {
        return implement(appContract.core.fleet.createMyAdmissionRequest)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const result = await this.fleetService.createMyAdmissionRequest(context.auth.user.id, input);
                return { status: 201 as const, headers: {}, body: result };
            });
    }

    @Implement(appContract.core.fleet.listMyAdmissionRequests)
    listMyAdmissionRequests() {
        return implement(appContract.core.fleet.listMyAdmissionRequests)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                return this.fleetService.listMyAdmissionRequests(context.auth.user.id, input.query ?? {});
            });
    }

    @Implement(appContract.core.fleet.upsertAllocation)
    upsertAllocation() {
        return implement(appContract.core.fleet.upsertAllocation)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const result = await this.fleetService.upsertAllocation(input);
                return { status: 201 as const, headers: {}, body: result };
            });
    }

    @Implement(appContract.core.fleet.deleteAllocation)
    deleteAllocation() {
        return implement(appContract.core.fleet.deleteAllocation)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const result = await this.fleetService.deleteAllocation(input);
                return { status: 201 as const, headers: {}, body: result };
            });
    }

    @Implement(appContract.core.fleet.listAdmissionRequests)
    listAdmissionRequests() {
        return implement(appContract.core.fleet.listAdmissionRequests)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.fleetService.listAdmissionRequests(input.query ?? {});
            });
    }

    @Implement(appContract.core.fleet.resolveAdmissionRequest)
    resolveAdmissionRequest() {
        return implement(appContract.core.fleet.resolveAdmissionRequest)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const result = await this.fleetService.resolveAdmissionRequest(input);
                return { status: 201 as const, headers: {}, body: result };
            });
    }
}
