import { createFilterConfig, standard, type ComputeInputSchema, standardDomainErrorContracts } from "@repo/orpc-utils";
import { dockerVolumeEntitySchema } from "@repo/contracts-entities";

const dockerVolumeListItemSchema = dockerVolumeEntitySchema.omit({ relations: true });
const dockerVolumeOps = standard.zod(dockerVolumeListItemSchema, "dockerVolume");

export const dockerVolumeListConfigSchemas = createFilterConfig(dockerVolumeOps)
  .withPagination({ defaultLimit: 50, maxLimit: 500, includeOffset: true } as const)
  .withSorting(["createdAt", "updatedAt", "name"] as const, {
    defaultField: "updatedAt",
    defaultDirection: "desc",
  })
  .withFiltering({
    name: { schema: dockerVolumeListItemSchema.shape.name, operators: ["eq", "like", "ilike"] as const },
    driver: { schema: dockerVolumeListItemSchema.shape.driver, operators: ["eq"] as const },
  })
  .buildConfig();

export type DockerVolumeListInput = ComputeInputSchema<typeof dockerVolumeListConfigSchemas>;

export const dockerListVolumesContract = dockerVolumeOps
  .list(dockerVolumeListConfigSchemas)
  .path("/")
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
