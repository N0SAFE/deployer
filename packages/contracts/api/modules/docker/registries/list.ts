import { createFilterConfig, standard, type ComputeInputSchema, standardDomainErrorContracts } from "@repo/orpc-utils";
import { dockerRegistryEntitySchema } from "@repo/contracts-entities";

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

export const dockerListRegistriesContract = dockerRegistryOps
  .list(dockerRegistryListConfigSchemas)
  .path("/")
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
