import { createFilterConfig, standard, type ComputeInputSchema } from "@repo/orpc-utils";
import { deploymentSchema, deploymentStatusSchema, deploymentEnvironmentSchema, sourceTypeSchema } from "@repo/api-contracts/common/deployment";

const deploymentOps = standard.zod(deploymentSchema, "deployment");

const deploymentListConfig = createFilterConfig(deploymentOps)
    .withPagination({ defaultLimit: 20, maxLimit: 100, includeOffset: true } as const)
    .withSorting(["createdAt", "updatedAt", "status"] as const, {
        defaultField: "createdAt",
        defaultDirection: "desc",
    })
    .withFiltering({
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
    })
    .buildConfig();

export const deploymentListConfigSchemas = deploymentListConfig;
export const deploymentListContract = deploymentOps.list(deploymentListConfig).build();
export type DeploymentListInput = ComputeInputSchema<typeof deploymentListConfigSchemas>;
