import * as z from "zod";
import { standard } from "@repo/orpc-utils";

const serviceDependencyAddParamsSchema = z.object({
  id: z.uuid(),
});

const serviceDependencyAddBodySchema = z.object({
  dependsOnServiceId: z.uuid(),
  isRequired: z.boolean().default(true),
});

const serviceDependencyAddOutputSchema = z.object({
  id: z.uuid(),
  serviceId: z.uuid(),
  dependsOnServiceId: z.uuid(),
  isRequired: z.boolean(),
  createdAt: z.date(),
});

const serviceDependencyAddOps = standard.zod(serviceDependencyAddOutputSchema, "serviceDependencyAdd");

export const serviceAddDependencyContract = serviceDependencyAddOps
  .create()
  .summary("Add service dependency")
  .path("/:id/dependencies")
  .input((input) =>
    input
      .params(serviceDependencyAddParamsSchema)
      .body(serviceDependencyAddBodySchema),
  )
  .output(serviceDependencyAddOutputSchema)
  .build();
