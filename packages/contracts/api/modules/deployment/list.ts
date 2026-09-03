import { createFilterConfig, standard, type ComputeInputSchema, standardDomainErrorContracts } from "@repo/orpc-utils";
import { deploymentSchema, deploymentStatusSchema, deploymentEnvironmentSchema, sourceTypeSchema } from "@repo/contracts-entities";
import z from "zod/v4";

const deploymentOps = standard.zod(deploymentSchema, "deployment");

const deploymentListConfig = createFilterConfig(deploymentOps)
    .withPagination({ defaultLimit: 20, maxLimit: 100, includeOffset: true } as const)
    .withSorting(["createdAt", "updatedAt", "status"] as const, {
        defaultField: "createdAt",
        defaultDirection: "desc",
    })
    .withFiltering({
        projectId: {
            schema: z.uuid(),
            operators: ["eq"] as const,
        },
        serviceId: {
            schema: deploymentSchema.shape.serviceId,
            operators: ["eq"] as const,
        },
        status: {
            schema: deploymentStatusSchema,
            operators: ["eq"] as const,
        },
        environment: {
            schema: deploymentEnvironmentSchema,
            operators: ["eq"] as const,
        },
        sourceType: {
            schema: sourceTypeSchema,
            operators: ["eq"] as const,
        },
        nodeId: {
            schema: z.uuid(),
            operators: ["eq"] as const,
        },
    })
    .buildConfig();

export const deploymentListConfigSchemas = deploymentListConfig;
export const deploymentListContract = deploymentOps.list(deploymentListConfig).errors((e) => [...standardDomainErrorContracts(e)]).build();
export type DeploymentListInput = ComputeInputSchema<typeof deploymentListConfigSchemas>;
