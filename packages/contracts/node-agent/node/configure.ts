import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

import { meshNodeConfigSchema, meshNodeStateSchema } from "./state";

/**
 * Configures this node — the only way a node is created.
 *
 * Every field is optional and the write is a patch: a named field replaces the stored one, an absent one keeps its
 * value, and the first call stamps `configuredAt`. Repeating the call with the same patch changes nothing, so the setup
 * flow, the API and a future CLI can all drive it without knowing who wrote what.
 */
export const meshNodeConfigureInput = meshNodeConfigSchema
  .omit({ configuredAt: true, updatedAt: true })
  .partial();

export type MeshNodeConfigureInput = z.infer<typeof meshNodeConfigureInput>;

const meshNodeConfigureOps = standard.zod(meshNodeStateSchema, "meshNodeConfigure");

export const meshNodeConfigureContract = meshNodeConfigureOps
  .create()
  .path("/configure")
  .input((b) => b.body(meshNodeConfigureInput))
  .output(meshNodeStateSchema)
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
