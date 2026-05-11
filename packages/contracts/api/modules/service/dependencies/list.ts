import * as z from "zod";
import { standard } from "@repo/orpc-utils";

const serviceDependenciesListParamsSchema = z.object({
  id: z.uuid(),
});

const serviceDependenciesListOutputSchema = z.object({
  dependencies: z.array(
    z.object({
      id: z.uuid(),
      serviceId: z.uuid(),
      dependsOnServiceId: z.uuid(),
      dependsOnService: z.object({
        id: z.uuid(),
        name: z.string(),
        type: z.string(),
      }),
      isRequired: z.boolean(),
      createdAt: z.date(),
    }),
  ),
});

const serviceDependenciesListOps = standard.zod(serviceDependenciesListOutputSchema, "serviceDependenciesList");

export const serviceGetDependenciesContract = serviceDependenciesListOps
  .list()
  .summary("Get service dependencies")
  .path("/:id/dependencies")
  .input((input) => input.params(serviceDependenciesListParamsSchema))
  .output(serviceDependenciesListOutputSchema)
  .build();
