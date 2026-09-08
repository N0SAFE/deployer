import { createFilterConfig, standard, type ComputeInputSchema } from "@repo/orpc-utils";
import { dockerStackEntitySchema } from "@repo/contracts-entities";

/**
 * Stack list query config — TYPE-ONLY surface.
 *
 * The docker stack *procedures* were removed (the fleet UI does not manage
 * stacks). This module survives because the engine runtime catalog
 * repository (`docker.repository.listStacks`) still consumes the typed
 * list query input to build the read-only `stacks` snapshot array.
 */

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
