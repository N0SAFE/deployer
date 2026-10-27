import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { nodesContract } from "@deployer/fleet-contracts";
import { EffectContextOf } from "@deployer/nest-effect";
import { requireAuth } from "@deployer/shared/core/modules/auth/orpc/middlewares";

import { serve } from "../../../core/orpc/serve";
import { FleetModule } from "../fleet.module";
import { FleetService } from "../services/fleet.service";

/**
 * Fleet Controller — implements the `nodes.*` ORPC contract.
 * Backed by the cluster fleet tables (cluster_nodes, allocations, admission requests).
 *
 * Every handler resolves `FleetService` from the module's Effect context and runs its use case
 * through `serve`, which provides the actor and correlation id and maps failures.
 *
 * NOTE: the contract must be referenced through `nodesContract.*`
 * so the `/nodes` router prefix is preserved in the mapped Nest routes.
 */
@Controller()
export class FleetController {
    @Implement(nodesContract.listServers)
    listServers() {
        return implement(nodesContract.listServers)
            .use(requireAuth())
            .use(FleetModule[EffectContextOf])
            .effect(function* ({ context }) {
                const fleet = yield* FleetService;
                return yield* serve(context)(fleet.listServers());
            });
    }

    @Implement(nodesContract.setServerCapacity)
    setServerCapacity() {
        return implement(nodesContract.setServerCapacity)
            .use(requireAuth())
            .use(FleetModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const fleet = yield* FleetService;
                const result = yield* serve(context)(fleet.setServerCapacity(input));
                return { status: 201 as const, body: result };
            });
    }

    @Implement(nodesContract.listAllocations)
    listAllocations() {
        return implement(nodesContract.listAllocations)
            .use(requireAuth())
            .use(FleetModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const fleet = yield* FleetService;
                return yield* serve(context)(fleet.listAllocations(input.query ?? {}));
            });
    }

    @Implement(nodesContract.listMyAllocations)
    listMyAllocations() {
        return implement(nodesContract.listMyAllocations)
            .use(requireAuth())
            .use(FleetModule[EffectContextOf])
            .effect(function* ({ context }) {
                const fleet = yield* FleetService;
                return yield* serve(context)(fleet.listMyAllocations());
            });
    }

    @Implement(nodesContract.checkMyAdmission)
    checkMyAdmission() {
        return implement(nodesContract.checkMyAdmission)
            .use(requireAuth())
            .use(FleetModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const fleet = yield* FleetService;
                const result = yield* serve(context)(fleet.checkMyAdmission(context.auth.user.id, input));
                return { status: 201 as const, headers: {}, body: result };
            });
    }

    @Implement(nodesContract.createMyAdmissionRequest)
    createMyAdmissionRequest() {
        return implement(nodesContract.createMyAdmissionRequest)
            .use(requireAuth())
            .use(FleetModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const fleet = yield* FleetService;
                const result = yield* serve(context)(fleet.createMyAdmissionRequest(context.auth.user.id, input));
                return { status: 201 as const, headers: {}, body: result };
            });
    }

    @Implement(nodesContract.listMyAdmissionRequests)
    listMyAdmissionRequests() {
        return implement(nodesContract.listMyAdmissionRequests)
            .use(requireAuth())
            .use(FleetModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const fleet = yield* FleetService;
                return yield* serve(context)(fleet.listMyAdmissionRequests(context.auth.user.id, input.query ?? {}));
            });
    }

    @Implement(nodesContract.upsertAllocation)
    upsertAllocation() {
        return implement(nodesContract.upsertAllocation)
            .use(requireAuth())
            .use(FleetModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const fleet = yield* FleetService;
                const result = yield* serve(context)(fleet.upsertAllocation(input));
                return { status: 201 as const, headers: {}, body: result };
            });
    }

    @Implement(nodesContract.deleteAllocation)
    deleteAllocation() {
        return implement(nodesContract.deleteAllocation)
            .use(requireAuth())
            .use(FleetModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const fleet = yield* FleetService;
                const result = yield* serve(context)(fleet.deleteAllocation(input));
                return { status: 201 as const, headers: {}, body: result };
            });
    }

    @Implement(nodesContract.listAdmissionRequests)
    listAdmissionRequests() {
        return implement(nodesContract.listAdmissionRequests)
            .use(requireAuth())
            .use(FleetModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const fleet = yield* FleetService;
                return yield* serve(context)(fleet.listAdmissionRequests(input.query ?? {}));
            });
    }

    @Implement(nodesContract.resolveAdmissionRequest)
    resolveAdmissionRequest() {
        return implement(nodesContract.resolveAdmissionRequest)
            .use(requireAuth())
            .use(FleetModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const fleet = yield* FleetService;
                const result = yield* serve(context)(fleet.resolveAdmissionRequest(input));
                return { status: 201 as const, headers: {}, body: result };
            });
    }
}
