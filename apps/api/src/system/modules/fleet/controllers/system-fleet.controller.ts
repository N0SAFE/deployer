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

    private toDate(value: string | Date): Date {
        return value instanceof Date ? value : new Date(value);
    }

    private toDateOrNull(value: string | Date | null): Date | null {
        if (!value) {
            return null;
        }

        return this.toDate(value);
    }

    @Implement(appContract.core.fleet.listServers)
    listServers() {
        return implement(appContract.core.fleet.listServers)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "superadmin"]))
            .handler(async () => {
                const items = await this.systemFleetService.listServers();
                return {
                    items: items.map((item) => ({
                        ...item,
                        lastSeenAt: this.toDateOrNull(item.lastSeenAt),
                        metrics: item.metrics
                            ? {
                                  ...item.metrics,
                                  reportedAt: this.toDate(item.metrics.reportedAt),
                              }
                            : null,
                    })),
                };
            });
    }

    @Implement(appContract.core.fleet.setServerCapacity)
    setServerCapacity() {
        return implement(appContract.core.fleet.setServerCapacity)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "superadmin"]))
            .handler(async ({ input }) => {
                const server = await this.systemFleetService.setServerCapacity({
                    serverNodeId: input.serverNodeId,
                    maxCpuMillicores: input.maxCpuMillicores ?? null,
                    maxMemoryMb: input.maxMemoryMb ?? null,
                });

                return {
                    status: 201,
                    body: {
                        ...server,
                        lastSeenAt: this.toDateOrNull(server.lastSeenAt),
                        metrics: server.metrics
                            ? {
                                  ...server.metrics,
                                  reportedAt: this.toDate(server.metrics.reportedAt),
                              }
                            : null,
                    },
                };
            });
    }

    @Implement(appContract.core.fleet.listAllocations)
    listAllocations() {
        return implement(appContract.core.fleet.listAllocations)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "superadmin"]))
            .handler(async ({ input }) => {
                const items = await this.systemFleetService.listAllocations(input.query ?? {});
                return {
                    items: items.map((item) => ({
                        ...item,
                        updatedAt: this.toDate(item.updatedAt),
                    })),
                };
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
                return {
                    items: items.map((item) => ({
                        ...item,
                        updatedAt: this.toDate(item.updatedAt),
                    })),
                };
            });
    }

    @Implement(appContract.core.fleet.upsertAllocation)
    upsertAllocation() {
        return implement(appContract.core.fleet.upsertAllocation)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "superadmin"]))
            .handler(async ({ input, context }) => {
                const actor = this.resolveAuthActor(context);
                const allocation = await this.systemFleetService.upsertAllocation({
                    ...input,
                    actorUserId: actor.userId,
                    maxServices: input.maxServices ?? null,
                });

                return {
                    status: 201,
                    body: {
                        ...allocation,
                        updatedAt: this.toDate(allocation.updatedAt),
                    },
                };
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

                const result = await this.systemFleetService.checkAdmission({
                    organizationId,
                    requestedCpuMillicores: input.requestedCpuMillicores,
                    requestedMemoryMb: input.requestedMemoryMb,
                    requestedServices: input.requestedServices,
                    serverNodeId: input.serverNodeId,
                });

                return {
                    status: 201,
                    body: {
                        ...result,
                        evaluatedAt: this.toDate(result.evaluatedAt),
                    },
                };
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

                const request = await this.systemFleetService.createAdmissionRequest({
                    organizationId,
                    requesterUserId: actor.userId,
                    requestedCpuMillicores: input.requestedCpuMillicores,
                    requestedMemoryMb: input.requestedMemoryMb,
                    requestedServices: input.requestedServices,
                    requestedServerNodeId: input.requestedServerNodeId,
                    requesterNote: input.requesterNote ?? null,
                });

                return {
                    status: 201,
                    body: {
                        ...request,
                        reviewedAt: this.toDateOrNull(request.reviewedAt),
                        createdAt: this.toDate(request.createdAt),
                        updatedAt: this.toDate(request.updatedAt),
                    },
                };
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

                return {
                    items: items.map((item) => ({
                        ...item,
                        reviewedAt: this.toDateOrNull(item.reviewedAt),
                        createdAt: this.toDate(item.createdAt),
                        updatedAt: this.toDate(item.updatedAt),
                    })),
                };
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

                return {
                    items: items.map((item) => ({
                        ...item,
                        reviewedAt: this.toDateOrNull(item.reviewedAt),
                        createdAt: this.toDate(item.createdAt),
                        updatedAt: this.toDate(item.updatedAt),
                    })),
                };
            });
    }

    @Implement(appContract.core.fleet.resolveAdmissionRequest)
    resolveAdmissionRequest() {
        return implement(appContract.core.fleet.resolveAdmissionRequest)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "superadmin"]))
            .handler(async ({ input, context }) => {
                const actor = this.resolveAuthActor(context);

                const request = await this.systemFleetService.resolveAdmissionRequest({
                    requestId: input.requestId,
                    decision: input.decision,
                    reviewerUserId: actor.userId,
                    reviewerNote: input.reviewerNote ?? null,
                    decisionServerNodeId: input.decisionServerNodeId ?? null,
                });

                return {
                    status: 201,
                    body: {
                        ...request,
                        reviewedAt: this.toDateOrNull(request.reviewedAt),
                        createdAt: this.toDate(request.createdAt),
                        updatedAt: this.toDate(request.updatedAt),
                    },
                };
            });
    }

    @Implement(appContract.core.fleet.deleteAllocation)
    deleteAllocation() {
        return implement(appContract.core.fleet.deleteAllocation)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "superadmin"]))
            .handler(async ({ input }) => {
                const result = await this.systemFleetService.deleteAllocation(input);
                return {
                    status: 201,
                    body: result,
                };
            });
    }
}
