import * as z from "zod";
import { createFilterConfig, standard, type ComputeInputSchema, standardDomainErrorContracts } from "@repo/orpc-utils";
import { serviceObjectShape } from "@repo/contracts-entities";

const serviceOps = standard.zod(serviceObjectShape, "service");

const serviceListConfig = createFilterConfig(serviceOps)
    .withPagination({ defaultLimit: 20, maxLimit: 100, includeOffset: true } as const)
    .withSorting(["createdAt", "name", "updatedAt"] as const, {
        defaultField: "createdAt",
        defaultDirection: "desc",
    })
    .withFiltering({
        projectId: {
            schema: serviceObjectShape.shape.projectId,
            operators: ["eq"] as const,
        },
        name: {
            schema: serviceObjectShape.shape.name,
            operators: ["eq", "like", "ilike"] as const,
        },
        type: {
            schema: serviceObjectShape.shape.type,
            operators: ["eq"] as const,
        },
        parentId: {
            schema: z.uuid(),
            operators: ["eq", "isNull"] as const,
        },
    })
    .buildConfig();

export const serviceListConfigSchemas = serviceListConfig;
export const serviceListContract = serviceOps.list(serviceListConfig).errors((e) => [...standardDomainErrorContracts(e)]).build();
export type ServiceListInput = ComputeInputSchema<typeof serviceListConfigSchemas>;
