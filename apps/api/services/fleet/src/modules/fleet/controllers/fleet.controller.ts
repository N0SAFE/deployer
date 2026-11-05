import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";

import { nodesContract } from "@deployer/fleet-contracts";
import { procedure } from "@deployer/nest-effect";
import { requireAuth, requirePlatformRole } from "@deployer/shared/core/modules/auth/orpc/middlewares";

import { FleetService } from "../services/fleet.service";

/**
 * Fleet Controller — implements the `nodes.*` ORPC contract.
 * Backed by the cluster fleet tables (cluster_nodes, allocations, admission requests).
 *
 * Every handler resolves `FleetService` from the module's Effect context and runs its use case
 * through the `.effect()` boundary, which provides the actor and correlation id and maps failures.
 *
 * NOTE: the contract must be referenced through `nodesContract.*`
 * so the `/nodes` router prefix is preserved in the mapped Nest routes.
 */

/** Capacity, allocations and admission decisions are operational acts; self-service stays per-user. */
const FLEET_OPERATOR_ROLES = ["superAdmin", "admin", "operator"];

@Controller()
export class FleetController {
    @Implement(nodesContract.listServers)
    listServers() {
        return procedure(nodesContract.listServers)
            .use(requireAuth())
            .effect(function* () {
                const fleet = yield* FleetService;
                return yield* fleet.listServers();
            });
    }

    @Implement(nodesContract.setServerCapacity)
    setServerCapacity() {
        return procedure(nodesContract.setServerCapacity)
            .use(requireAuth())
            .use(requirePlatformRole(FLEET_OPERATOR_ROLES))
            .effect(function* ({ input }) {
                const fleet = yield* FleetService;
                const result = yield* fleet.setServerCapacity(input);
                return { status: 201 as const, body: result };
            });
    }

    @Implement(nodesContract.listAllocations)
    listAllocations() {
        return procedure(nodesContract.listAllocations)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const fleet = yield* FleetService;
                return yield* fleet.listAllocations(input.query ?? {});
            });
    }

    @Implement(nodesContract.listMyAllocations)
    listMyAllocations() {
        return procedure(nodesContract.listMyAllocations)
            .use(requireAuth())
            .effect(function* () {
                const fleet = yield* FleetService;
                return yield* fleet.listMyAllocations();
            });
    }

    @Implement(nodesContract.checkMyAdmission)
    checkMyAdmission() {
        return procedure(nodesContract.checkMyAdmission)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const fleet = yield* FleetService;
                const result = yield* fleet.checkMyAdmission(context.auth.user.id, input);
                return { status: 201 as const, headers: {}, body: result };
            });
    }

    @Implement(nodesContract.createMyAdmissionRequest)
    createMyAdmissionRequest() {
        return procedure(nodesContract.createMyAdmissionRequest)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const fleet = yield* FleetService;
                const result = yield* fleet.createMyAdmissionRequest(context.auth.user.id, input);
                return { status: 201 as const, headers: {}, body: result };
            });
    }

    @Implement(nodesContract.listMyAdmissionRequests)
    listMyAdmissionRequests() {
        return procedure(nodesContract.listMyAdmissionRequests)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const fleet = yield* FleetService;
                return yield* fleet.listMyAdmissionRequests(context.auth.user.id, input.query ?? {});
            });
    }

    @Implement(nodesContract.upsertAllocation)
    upsertAllocation() {
        return procedure(nodesContract.upsertAllocation)
            .use(requireAuth())
            .use(requirePlatformRole(FLEET_OPERATOR_ROLES))
            .effect(function* ({ input }) {
                const fleet = yield* FleetService;
                const result = yield* fleet.upsertAllocation(input);
                return { status: 201 as const, headers: {}, body: result };
            });
    }

    @Implement(nodesContract.deleteAllocation)
    deleteAllocation() {
        return procedure(nodesContract.deleteAllocation)
            .use(requireAuth())
            .use(requirePlatformRole(FLEET_OPERATOR_ROLES))
            .effect(function* ({ input }) {
                const fleet = yield* FleetService;
                const result = yield* fleet.deleteAllocation(input);
                return { status: 201 as const, headers: {}, body: result };
            });
    }

    @Implement(nodesContract.listAdmissionRequests)
    listAdmissionRequests() {
        return procedure(nodesContract.listAdmissionRequests)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const fleet = yield* FleetService;
                return yield* fleet.listAdmissionRequests(input.query ?? {});
            });
    }

    @Implement(nodesContract.resolveAdmissionRequest)
    resolveAdmissionRequest() {
        return procedure(nodesContract.resolveAdmissionRequest)
            .use(requireAuth())
            .use(requirePlatformRole(FLEET_OPERATOR_ROLES))
            .effect(function* ({ input }) {
                const fleet = yield* FleetService;
                const result = yield* fleet.resolveAdmissionRequest(input);
                return { status: 201 as const, headers: {}, body: result };
            });
    }
}
