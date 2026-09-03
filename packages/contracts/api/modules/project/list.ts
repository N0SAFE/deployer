import { createFilterConfig, standard, type ComputeInputSchema, standardDomainErrorContracts } from "@repo/orpc-utils";
import { projectSchema } from "@repo/contracts-entities";

// Create standard operations builder for projects
const projectOps = standard.zod(projectSchema, "project");

// Build reusable list config with fluent API
const projectListConfig = createFilterConfig(projectOps)
    .withPagination({
        defaultLimit: 20,
        maxLimit: 100,
        includeOffset: true,
    } as const)
    .withSorting(["createdAt", "name", "updatedAt"] as const, {
        defaultField: "updatedAt",
        defaultDirection: "desc",
    })
    .withFiltering({
        id: projectSchema.shape.id,
        name: {
            schema: projectSchema.shape.name,
            operators: ["eq", "like", "ilike"] as const,
        },
        ownerId: projectSchema.shape.ownerId,
    })
    .buildConfig();

// Export reusable query configuration schemas
export const projectListConfigSchemas = projectListConfig;

// Build the list contract
export const projectListContract = projectOps.list(projectListConfig).errors((e) => [...standardDomainErrorContracts(e)]).build();

// Export input type helper - computed from the config
export type ProjectListInput = ComputeInputSchema<typeof projectListConfigSchemas>;
