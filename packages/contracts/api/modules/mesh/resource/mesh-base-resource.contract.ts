/**
 * Mesh Base Resource Contract
 *
 * A single ORPC catch-all contract that handles ALL mesh resource operations.
 * Path parameters (entityKey, methodName) route to the correct entity handler
 * at runtime via MeshResourceDispatcher.
 *
 * HTTP: POST /api/mesh/:entityKey/:methodName
 * Auth: requireAuth() applied in the controller (not baked into contract)
 *
 * @see mesh-resource.controller.ts — single @Implement
 * @see mesh-resource-dispatcher.service.ts — runtime dispatch
 */

import { z } from "zod/v4";
import { standard, meshDomainErrorContracts } from "@repo/orpc-utils";

// ─── Schemas ──────────────────────────────────────────────────────────────────

/** Placeholder entity schema — must be an object for standard.zod() internals.
 *  The actual input/output are overridden by .input().body() / .output().body(). */
const meshEntitySchema = z.object({});

const meshResourceBodySchema = z.unknown();
const meshResourceOutputSchema = z.unknown();

// ─── Contract ─────────────────────────────────────────────────────────────────

const ops = standard.zod(meshEntitySchema, "meshBaseResource");

export const meshBaseResourceContract = ops
  .create()
  .input((b) =>
    b
      .params((p) =>
        p`/mesh/${p("entityKey", z.string().min(1))}/${p("methodName", z.string().min(1))}`,
      )
      .body(meshResourceBodySchema),
  )
  .output((b) => b.body(meshResourceOutputSchema))
  .errors((e) => meshDomainErrorContracts(e))
  .build();