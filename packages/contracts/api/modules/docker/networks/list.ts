import { createFilterConfig, standard, type ComputeInputSchema } from "@repo/orpc-utils";
import { dockerNetworkEntitySchema } from "@repo/contracts-entities";

const dockerNetworkListItemSchema = dockerNetworkEntitySchema.omit({ relations: true });
const dockerNetworkOps = standard.zod(dockerNetworkListItemSchema, "dockerNetwork");

export const dockerNetworkListConfigSchemas = createFilterConfig(dockerNetworkOps)
  .withPagination({ defaultLimit: 50, maxLimit: 500, includeOffset: true } as const)
  .withSorting(["createdAt", "updatedAt", "name"] as const, {
    defaultField: "updatedAt",
    defaultDirection: "desc",
  })
  .withFiltering({
    name: { schema: dockerNetworkListItemSchema.shape.name, operators: ["eq", "like", "ilike"] as const },
    driver: { schema: dockerNetworkListItemSchema.shape.driver, operators: ["eq"] as const },
    scope: { schema: dockerNetworkListItemSchema.shape.scope, operators: ["eq"] as const },
  })
  .buildConfig();

export type DockerNetworkListInput = ComputeInputSchema<typeof dockerNetworkListConfigSchemas>;

export const dockerListNetworksContract = dockerNetworkOps
  .list(dockerNetworkListConfigSchemas)
  .path("/")
  .build();
