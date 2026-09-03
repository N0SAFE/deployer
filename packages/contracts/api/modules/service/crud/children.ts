import * as z from "zod";
import { serviceEffectiveConfigSchema, serviceObjectShape } from "@repo/contracts-entities";
import { serviceOps } from "./shared";
import { standardDomainErrorContracts } from "@repo/orpc-utils";

/**
 * Direct children (one level) of a service. Used by the tree UI to render the
 * first level; deeper levels are loaded per-child or via `findWithSubtree`.
 * Each child carries its resolved `effectiveConfig` (inherited from this
 * parent unless overridden).
 */
const serviceChildrenOutputSchema = z.object({
  children: z.array(
    serviceObjectShape.extend({ effectiveConfig: serviceEffectiveConfigSchema }),
  ),
});

export const serviceChildrenContract = serviceOps
  .list()
  .summary("List direct child services (sub-services) of a service")
  // path-template params form — schema-only `.input(params(schema))` does
  // NOT wire URL substitution in the OpenAPI client (requests went out as
  // `/services/:id/children` even with a valid id).
  .input((b) => b.params((p) => p`/${p("id", z.uuid())}/children`))
  .output(serviceChildrenOutputSchema)
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();

/**
 * The full descendant subtree of a service as a nested tree. Each node is a
 * full service object with an optional `children` array (recursive — zod v4
 * native `get` accessor, no `z.lazy()`) plus its resolved `effectiveConfig`.
 */
const serviceSubtreeNodeSchema = serviceObjectShape.extend({
  effectiveConfig: serviceEffectiveConfigSchema,
  get children() {
    return z.array(serviceSubtreeNodeSchema).optional();
  },
});

export const serviceSubtreeContract = serviceOps
  .read()
  .summary("Get the whole descendant subtree of a service (nested)")
  .input((b) => b.params((p) => p`/${p("id", z.uuid())}/subtree`))
  .output(serviceSubtreeNodeSchema.nullable())
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
