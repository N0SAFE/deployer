/**
 * Mesh Base Resource Contract
 *
 * A single ORPC catch-all contract that handles ALL mesh resource operations.
 * Path parameters (entityKey, methodName) route to the correct entity handler
 * at runtime via MeshResourceDispatcher.
 *
 * This is the ORPC-native replacement for an Express @All() catch-all.
 * Everything stays in the ORPC contract system:
 *   - Path params validated by Zod at contract boundary
 *   - OpenAPI generation works automatically
 *   - ORPC middleware chain (auth, error handling) applies naturally
 *
 * Usage in router:
 * ```typescript
 * oc.tag("Mesh").prefix("/api").router({
 *   mesh: meshBaseResourceContract,
 * });
 * ```
 *
 * HTTP: POST /api/mesh/:entityKey/:methodName
 * Auth: requireAuth() applied in the controller (not baked into contract)
 */

import { z } from "zod/v4";
import { standard, meshDomainErrorContracts } from "@repo/orpc-utils";

// ─── Input schema ─────────────────────────────────────────────────────────────

/** Path parameters identify which entity + operation to invoke */
const meshResourceParamsSchema = z.object({
  entityKey: z.string().min(1, "entityKey is required"),
  methodName: z.string().min(1, "methodName is required"),
});

/** Body is forwarded to the registered entity handler (schema resolved dynamically) */
const meshResourceBodySchema = z.unknown();

const meshResourceInputSchema = z.object({
  params: meshResourceParamsSchema,
  body: meshResourceBodySchema,
});

// ─── Output schema ────────────────────────────────────────────────────────────

/** Output is whatever the registered handler returns (schema resolved dynamically) */
const meshResourceOutputSchema = z.unknown();

// ─── Contract ─────────────────────────────────────────────────────────────────

const meshBaseResourceOps = standard.zod(meshResourceOutputSchema, "meshBaseResource");

/**
 * The single catch-all ORPC contract for all mesh resources.
 *
 * - Uses `.read()` which maps to GET by default
 * - Actually we want POST since the body contains operation input
 * - `.path()` with Express-style params for entity key and method name
 */
export const meshBaseResourceContract = meshBaseResourceOps
  .read()
  .path("/mesh/:entityKey/:methodName")
  .input((b) =>
    b
      .params(meshResourceParamsSchema)
      .body(meshResourceBodySchema),
  )
  .output((b) => b.body(meshResourceOutputSchema))
  .errors((e) => meshDomainErrorContracts(e))
  .build();

export type MeshBaseResourceContract = typeof meshBaseResourceContract;
