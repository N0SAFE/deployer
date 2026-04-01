import * as z from "zod";
import { createFilterConfig, standard, type ComputeInputSchema } from "@repo/orpc-utils";
import { serviceSchema } from "@repo/contracts-entities";

const serviceOps = standard.zod(serviceSchema, "service");

const serviceListConfig = createFilterConfig(serviceOps)
    .withPagination({ defaultLimit: 20, maxLimit: 100, includeOffset: true } as const)
    .withSorting(["createdAt", "name", "updatedAt"] as const, {
        defaultField: "createdAt",
        defaultDirection: "desc",
    })
    .withFiltering({
        projectId: {
            schema: serviceSchema.shape.projectId,
            operators: ["eq"] as const,
        },
        name: {
            schema: serviceSchema.shape.name,
            operators: ["eq", "like", "ilike"] as const,
        },
        type: {
            schema: serviceSchema.shape.type,
            operators: ["eq"] as const,
        },
    })
    .buildConfig();

export const serviceListConfigSchemas = serviceListConfig;
export const serviceListContract = serviceOps.list(serviceListConfig).build();
export type ServiceListInput = ComputeInputSchema<typeof serviceListConfigSchemas>;
