import z from "zod/v4";
import { createFilterConfig, standard, type ComputeInputSchema, standardDomainErrorContracts } from "@repo/orpc-utils";
import { dockerImageEntitySchema } from "@repo/contracts-entities";

const dockerImageListItemSchema = dockerImageEntitySchema
  .omit({ relations: true })
  .extend({
    projectId: z.string().optional(),
  });
const dockerImageOps = standard.zod(dockerImageListItemSchema, "dockerImage");

export const dockerImageListConfigSchemas = createFilterConfig(dockerImageOps)
  .withPagination({ defaultLimit: 50, maxLimit: 500, includeOffset: true } as const)
  .withSorting(["createdAt", "lastSeenAt", "registry", "repository"] as const, {
    defaultField: "lastSeenAt",
    defaultDirection: "desc",
  })
  .withFiltering({
    registry: { schema: dockerImageListItemSchema.shape.registry, operators: ["eq", "like", "ilike"] as const },
    repository: { schema: dockerImageListItemSchema.shape.repository, operators: ["eq", "like", "ilike"] as const },
    tag: { schema: dockerImageListItemSchema.shape.tag, operators: ["eq", "like", "ilike"] as const },
    projectId: { schema: z.string(), operators: ["eq"] as const },
  })
  .buildConfig();

export type DockerImageListInput = ComputeInputSchema<typeof dockerImageListConfigSchemas>;

export const dockerListImagesContract = dockerImageOps
  .list(dockerImageListConfigSchemas)
  .path("/")
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
