import { Controller, ForbiddenException } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { appContract } from "@repo/api-contracts";
import { requireAuth, requirePlatformRole } from "@/core/modules/auth/orpc/middlewares";
import { SystemFleetService } from "../services/system-fleet.service";

@Controller()
export class SystemFleetController {
    constructor(private readonly systemFleetService: SystemFleetService) {}

    private resolveOrganizationScope(context: unknown): string | null {
        const authContext =
            context && typeof context === "object" && "auth" in context
                ? (context as { auth?: { session?: { activeOrganizationId?: unknown } | null } }).auth
                : undefined;

        const activeOrganizationId = authContext?.session?.activeOrganizationId;
        return typeof activeOrganizationId === "string" && activeOrganizationId.length > 0
            ? activeOrganizationId
            : null;
    }

    private resolveAuthActor(context: unknown): { userId: string | null } {
        const authContext =
            context && typeof context === "object" && "auth" in context
                ? (context as { auth?: { user?: { id?: unknown } | null } }).auth
                : undefined;

        const userId = authContext?.user?.id;

        return {
            userId: typeof userId === "string" && userId.length > 0 ? userId : null,
        };
    }

    @Implement(appContract.core.fleet.listServers)
    listServers() {
        return implement(appContract.core.fleet.listServers)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "superadmin"]))
            .handler(async () => {
                const items = await this.systemFleetService.listServers();
                return { items };
            });
    }

    @Implement(appContract.core.fleet.setServerCapacity)
    setServerCapacity() {
        return implement(appContract.core.fleet.setServerCapacity)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "superadmin"]))
            .handler(async ({ input }) => {
                return this.systemFleetService.setServerCapacity({
                    serverNodeId: input.serverNodeId,
                    maxCpuMillicores: input.maxCpuMillicores ?? null,
                    maxMemoryMb: input.maxMemoryMb ?? null,
                });
            });
    }

    @Implement(appContract.core.fleet.listAllocations)
    listAllocations() {
        return implement(appContract.core.fleet.listAllocations)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "superadmin"]))
            .handler(async ({ input }) => {
                const items = await this.systemFleetService.listAllocations(input.query ?? {});
                return { items };
            });
    }

    @Implement(appContract.core.fleet.listMyAllocations)
    listMyAllocations() {
        return implement(appContract.core.fleet.listMyAllocations)
            .use(requireAuth())
            .handler(async ({ context }) => {
                const organizationId = this.resolveOrganizationScope(context);
                if (!organizationId) {
                    throw new ForbiddenException("Active organization is required to read fleet allocations");
                }

                const items = await this.systemFleetService.listAllocations({ organizationId });
                return { items };
            });
    }

    @Implement(appContract.core.fleet.upsertAllocation)
    upsertAllocation() {
        return implement(appContract.core.fleet.upsertAllocation)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "superadmin"]))
            .handler(async ({ input, context }) => {
                const actor = this.resolveAuthActor(context);
                return this.systemFleetService.upsertAllocation({
                    ...input,
                    actorUserId: actor.userId,
                    maxServices: input.maxServices ?? null,
                });
            });
    }

    @Implement(appContract.core.fleet.checkMyAdmission)
    checkMyAdmission() {
        return implement(appContract.core.fleet.checkMyAdmission)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const organizationId = this.resolveOrganizationScope(context);
                if (!organizationId) {
                    throw new ForbiddenException("Active organization is required to check fleet admission");
                }

                return this.systemFleetService.checkAdmission({
                    organizationId,
                    requestedCpuMillicores: input.requestedCpuMillicores,
                    requestedMemoryMb: input.requestedMemoryMb,
                    requestedServices: input.requestedServices,
                    serverNodeId: input.serverNodeId,
                });
            });
    }

    @Implement(appContract.core.fleet.createMyAdmissionRequest)
    createMyAdmissionRequest() {
        return implement(appContract.core.fleet.createMyAdmissionRequest)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const organizationId = this.resolveOrganizationScope(context);
                if (!organizationId) {
                    throw new ForbiddenException("Active organization is required to create admission requests");
                }

                const actor = this.resolveAuthActor(context);

                return this.systemFleetService.createAdmissionRequest({
                    organizationId,
                    requesterUserId: actor.userId,
                    requestedCpuMillicores: input.requestedCpuMillicores,
                    requestedMemoryMb: input.requestedMemoryMb,
                    requestedServices: input.requestedServices,
                    requestedServerNodeId: input.requestedServerNodeId,
                    requesterNote: input.requesterNote ?? null,
                });
            });
    }

    @Implement(appContract.core.fleet.listMyAdmissionRequests)
    listMyAdmissionRequests() {
        return implement(appContract.core.fleet.listMyAdmissionRequests)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const organizationId = this.resolveOrganizationScope(context);
                if (!organizationId) {
                    throw new ForbiddenException("Active organization is required to list admission requests");
                }

                const items = await this.systemFleetService.listAdmissionRequests({
                    organizationId,
                    status: input.query?.status,
                });

                return { items };
            });
    }

    @Implement(appContract.core.fleet.listAdmissionRequests)
    listAdmissionRequests() {
        return implement(appContract.core.fleet.listAdmissionRequests)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "superadmin"]))
            .handler(async ({ input }) => {
                const items = await this.systemFleetService.listAdmissionRequests({
                    organizationId: input.query?.organizationId,
                    status: input.query?.status,
                });

                return { items };
            });
    }

    @Implement(appContract.core.fleet.resolveAdmissionRequest)
    resolveAdmissionRequest() {
        return implement(appContract.core.fleet.resolveAdmissionRequest)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "superadmin"]))
            .handler(async ({ input, context }) => {
                const actor = this.resolveAuthActor(context);

                return this.systemFleetService.resolveAdmissionRequest({
                    requestId: input.requestId,
                    decision: input.decision,
                    reviewerUserId: actor.userId,
                    reviewerNote: input.reviewerNote ?? null,
                    decisionServerNodeId: input.decisionServerNodeId ?? null,
                });
            });
    }

    @Implement(appContract.core.fleet.deleteAllocation)
    deleteAllocation() {
        return implement(appContract.core.fleet.deleteAllocation)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "superadmin"]))
            .handler(async ({ input }) => {
                return this.systemFleetService.deleteAllocation(input);
            });
    }
}
