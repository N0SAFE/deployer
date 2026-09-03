import * as z from "zod";
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";

const serviceDependencyAddBodySchema = z.object({
  dependsOnServiceId: z.uuid(),
  isRequired: z.boolean().default(true),
});

const serviceDependencyAddOutputSchema = z.object({
  id: z.uuid(),
  serviceId: z.uuid(),
  dependsOnServiceId: z.uuid(),
  isRequired: z.boolean(),
  // The API returns ISO-8601 strings, not Date objects.
  createdAt: z.string(),
});

const serviceDependencyAddOps = standard.zod(serviceDependencyAddOutputSchema, "serviceDependencyAdd");

export const serviceAddDependencyContract = serviceDependencyAddOps
  .create()
  .summary("Add service dependency")
  // path-template params form (schema-only `.input(params(schema))` does not
  // wire URL substitution in the OpenAPI client).
  .input((b) =>
    b
      .params((p) => p`/${p("id", z.uuid())}/dependencies`)
      .body(serviceDependencyAddBodySchema),
  )
  .output(serviceDependencyAddOutputSchema)
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
