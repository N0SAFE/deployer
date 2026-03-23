import { createFilterConfig, standard, type ComputeInputSchema } from "@repo/orpc-utils";
import { deploymentTemplateSchema } from "@repo/api-contracts/common/template";

const templateOps = standard.zod(deploymentTemplateSchema, "deploymentTemplate");

const templateListConfig = createFilterConfig(templateOps)
    .withPagination({
        defaultLimit: 20,
        maxLimit: 100,
        includeOffset: true,
    } as const)
    .withSorting(["createdAt", "updatedAt", "name", "key", "version"] as const, {
        defaultField: "updatedAt",
        defaultDirection: "desc",
    })
    .withFiltering({
        id: deploymentTemplateSchema.shape.id,
        kind: deploymentTemplateSchema.shape.kind,
        scope: deploymentTemplateSchema.shape.scope,
        status: deploymentTemplateSchema.shape.status,
        key: {
            schema: deploymentTemplateSchema.shape.key,
            operators: ["eq", "like", "ilike"] as const,
        },
        name: {
            schema: deploymentTemplateSchema.shape.name,
            operators: ["eq", "like", "ilike"] as const,
        },
        version: {
            schema: deploymentTemplateSchema.shape.version,
            operators: ["eq", "like"] as const,
        },
        createdAt: {
            schema: deploymentTemplateSchema.shape.createdAt,
            operators: ["gt", "gte", "lt", "lte", "between"] as const,
        },
        updatedAt: {
            schema: deploymentTemplateSchema.shape.updatedAt,
            operators: ["gt", "gte", "lt", "lte", "between"] as const,
        },
    })
    .buildConfig();

export const templateListConfigSchemas = templateListConfig;

export const templateListContract = templateOps.list(templateListConfig).build();

export type TemplateListInput = ComputeInputSchema<typeof templateListConfigSchemas>;
