import { createFilterConfig, standard, type ComputeInputSchema } from "@repo/orpc-utils";
import { dockerRegistryEntitySchema } from "@repo/contracts-entities";

/**
 * Registry list query config — TYPE-ONLY surface.
 *
 * The docker registry *procedures* were removed (the fleet UI does not manage
 * registries). This module survives because the engine runtime catalog
 * repository (`docker.repository.listRegistries`) still consumes the typed
 * list query input to build the read-only `registries` snapshot array.
 */

const dockerRegistryListItemSchema = dockerRegistryEntitySchema.omit({ relations: true });
const dockerRegistryOps = standard.zod(dockerRegistryListItemSchema, "dockerRegistry");

export const dockerRegistryListConfigSchemas = createFilterConfig(dockerRegistryOps)
  .withPagination({ defaultLimit: 50, maxLimit: 500, includeOffset: true } as const)
  .withSorting(["createdAt", "updatedAt", "name", "url"] as const, {
    defaultField: "updatedAt",
    defaultDirection: "desc",
  })
  .withFiltering({
    name: { schema: dockerRegistryListItemSchema.shape.name, operators: ["eq", "like", "ilike"] as const },
    status: { schema: dockerRegistryListItemSchema.shape.status, operators: ["eq"] as const },
    isPrimary: { schema: dockerRegistryListItemSchema.shape.isPrimary, operators: ["eq"] as const },
  })
  .buildConfig();

export type DockerRegistryListInput = ComputeInputSchema<typeof dockerRegistryListConfigSchemas>;
