import { Injectable, Logger, NotFoundException, type OnModuleInit } from "@nestjs/common";
import type { DeploymentListInput } from "@repo/api-contracts/modules/deployment/list";
import type { DeploymentSummary } from "../services/deployment-mesh.service";
import { DeploymentMeshService } from "../services/deployment-mesh.service";
import { SystemMeshTopologyService } from "@/core/modules/mesh/services/system-mesh-topology/orchestrator/system-mesh-topology.service";
import { DeploymentService } from "../../services/deployment.service";

@Injectable()
export class DeploymentMeshHandlerRegistrar implements OnModuleInit {
    private readonly logger = new Logger(DeploymentMeshHandlerRegistrar.name);

    constructor(
        private readonly deploymentMeshService: DeploymentMeshService,
        private readonly deploymentService: DeploymentService,
        private readonly systemMeshTopologyService: SystemMeshTopologyService,
    ) {}

    onModuleInit(): void {
        this.deploymentMeshService.registerResolveDeploymentHandler(async ({ payload }) => {
            try {
                const deployment = await this.deploymentService.getDeploymentById(payload.deploymentId);

                return {
                    payload: {
                        found: true,
                        ownerNodeId: this.getLocalNodeId(),
                        ownerServerUrl: null,
                        metadata: {
                            deploymentId: deployment.id,
                            key: payload.key,
                        },
                    },
                    stopPropagation: true,
                };
            } catch (error: unknown) {
                if (error instanceof NotFoundException) {
                    return {
                        payload: {
                            found: false,
                            ownerNodeId: null,
                            ownerServerUrl: null,
                            metadata: null,
                        },
                    };
                }
                throw error;
            }
        });

        this.deploymentMeshService.registerSearchDeploymentsHandler(async ({ payload }) => {
            const listResult = await this.deploymentService.listDeployments({
                limit: payload.limit,
                offset: 0,
                sortBy: "createdAt",
                sortDirection: "desc",
            });

            const query = payload.query.trim().toLowerCase();
            const items = listResult.data
                .filter((deployment) =>
                    deployment.id.toLowerCase().includes(query) ||
                    deployment.serviceId.toLowerCase().includes(query) ||
                    deployment.status.toLowerCase().includes(query) ||
                    deployment.environment.toLowerCase().includes(query),
                )
                .map((deployment) => this.toSummary(deployment));

            return {
                payload: {
                    items,
                    total: items.length,
                },
                stopPropagation: items.length > 0,
            };
        });

        this.deploymentMeshService.registerListDeploymentsHandler(async ({ payload }) => {
            const serviceIds = payload.projectId
                ? await this.deploymentService.getProjectServiceIds(payload.projectId)
                : [];

            const listInputs: DeploymentListInput[] = serviceIds.length > 0
                ? serviceIds.map((serviceId) =>
                    this.createListInput({
                        serviceId,
                        status: payload.status,
                        environment: payload.environment,
                        limit: payload.limit,
                    }),
                )
                : [
                    this.createListInput({
                        serviceId: payload.serviceId,
                        status: payload.status,
                        environment: payload.environment,
                        limit: payload.limit,
                    }),
                ];

            const settled = await Promise.all(listInputs.map((input) => this.deploymentService.listDeployments(input)));
            const items = settled
                .flatMap((result) => result.data)
                .map((deployment) => this.toSummary(deployment));

            return {
                payload: {
                    items,
                    total: items.length,
                },
            };
        });

        this.logger.log("Deployment mesh handlers registered");
    }

    private createListInput(input: {
        serviceId?: string;
        status?: string;
        environment?: string;
        limit: number;
    }): DeploymentListInput {
        return {
            limit: input.limit,
            offset: 0,
            sortBy: "createdAt",
            sortDirection: "desc",
            filter: {
                ...(input.serviceId ? { serviceId: { operator: "eq", value: input.serviceId } } : {}),
                ...(input.status ? { status: { operator: "eq", value: input.status } } : {}),
                ...(input.environment ? { environment: { operator: "eq", value: input.environment } } : {}),
            },
        } as DeploymentListInput;
    }

    private toSummary(deployment: {
        id: string;
        serviceId: string;
        status: string;
        environment: string;
        metadata?: Record<string, unknown> | null;
    }): DeploymentSummary {
        return {
            deploymentId: deployment.id,
            serviceId: deployment.serviceId,
            status: deployment.status,
            environment: deployment.environment,
            ownerNodeId: this.getLocalNodeId(),
            metadata: deployment.metadata ?? null,
        };
    }

    private getLocalNodeId(): string {
        return this.systemMeshTopologyService.getLocalNode().nodeId;
    }
}
