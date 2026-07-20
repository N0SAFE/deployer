/**
 * Mesh Base Resource Contract
 *
 * A single ORPC catch-all contract that handles ALL mesh resource operations.
 * Path parameters (entityKey, methodName) route to the correct entity handler
 * at runtime via MeshResourceDispatcher.
 *
 * HTTP: POST /api/mesh/:entityKey/:methodName
 * Auth: requireAuth() applied in the controller (not baked into contract)
 */

import { z } from "zod/v4";
import { standard, meshDomainErrorContracts, RouteBuilder } from "@repo/orpc-utils";
import { ContractProcedureBuilderWithInputOutput } from "@orpc/contract";

// ─── Input schema ─────────────────────────────────────────────────────────────

const meshResourceBodySchema = z.unknown();

// ─── Output schema ────────────────────────────────────────────────────────────

const meshResourceOutputSchema = z.unknown();

// ─── Contract ─────────────────────────────────────────────────────────────────

const ops = standard.zod(meshResourceOutputSchema, "meshBaseResource");

/**
 * Single catch-all contract for all mesh resource operations.
 *
 * Path params (entityKey, methodName) are extracted from the URL via
 * ORPC's template-literal syntax. The body is forwarded to the handler.
 *
 * HTTP: POST /api/mesh/:entityKey/:methodName
 *   Path params: entityKey (string), methodName (string)
 *   Body: forwarded to registered handler (z.unknown)
 */
export const meshBaseResourceContract = ops
  .create()
  .path("/mesh/:entityKey/:methodName")
  .input((b) =>
    b
      .params((p) =>
        p`/mesh/${p("entityKey", z.string().min(1))}/${p("methodName", z.string().min(1))}`,
      )
      .body(meshResourceBodySchema),
  )
  .output((b) => b.body(meshResourceOutputSchema))
  .errors((e) => meshDomainErrorContracts(e))

  type e =  typeof meshBaseResourceContract extends RouteBuilder<infer T, infer U, infer V, infer W, infer E> ? E : never;