import { createFilterConfig, standard, type ComputeInputSchema } from "@repo/orpc-utils";
import { dockerStackEntitySchema } from "@repo/contracts-entities";

const dockerStackListItemSchema = dockerStackEntitySchema.omit({ relations: true });
const dockerStackOps = standard.zod(dockerStackListItemSchema, "dockerStack");

export const dockerStackListConfigSchemas = createFilterConfig(dockerStackOps)
  .withPagination({ defaultLimit: 50, maxLimit: 500, includeOffset: true } as const)
  .withSorting(["createdAt", "updatedAt", "name", "projectId"] as const, {
    defaultField: "updatedAt",
    defaultDirection: "desc",
  })
  .withFiltering({
    name: { schema: dockerStackListItemSchema.shape.name, operators: ["eq", "like", "ilike"] as const },
    status: { schema: dockerStackListItemSchema.shape.status, operators: ["eq"] as const },
    projectId: { schema: dockerStackListItemSchema.shape.projectId, operators: ["eq"] as const },
  })
  .buildConfig();

export type DockerStackListInput = ComputeInputSchema<typeof dockerStackListConfigSchemas>;

export const dockerListStacksContract = dockerStackOps
  .list(dockerStackListConfigSchemas)
  .path("/")
  .build();
