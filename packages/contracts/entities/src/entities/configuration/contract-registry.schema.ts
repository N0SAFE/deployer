import z from "zod/v4";

/**
 * CONTRACT REGISTRY — the "interface" in dependency-injection terms.
 *
 * A contract is a shared definition (OpenAPI / protobuf / JSON-schema) that
 * multiple services implement. The platform uses it to:
 *  1. VALIDATE mock swaps: a mock must implement the same contractRef as the
 *     service it replaces (never silently serve wrong data).
 *  2. AUTO-DISCOVER mocks: pick the first mock implementer of a contract when
 *     no explicit mockRef is given.
 *
 * Lives at project scope: a project owns the contracts its services share.
 */
export const serviceContractRegistrySchema = z
  .object({
    /** Unique contract id, e.g. "api.oas3", "checkout.payment", "user.events". */
    contractRef: z.string().min(1),
    /** Where the contract definition lives. */
    source: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("openapi"), path: z.string().min(1) }),
      z.object({ kind: z.literal("proto"), path: z.string().min(1) }),
      z.object({ kind: z.literal("json-schema"), path: z.string().min(1) }),
    ]),
    /** Version to enforce compatibility between implementers. */
    version: z.string().min(1).default("1"),
    /** Human-readable description. */
    description: z.string().optional(),
  })
  .strict();
export type ServiceContractRegistry = z.infer<typeof serviceContractRegistrySchema>;

/** A project's set of contracts (keyed by contractRef). */
export const serviceContractRegistryMapSchema = z
  .record(z.string().min(1), serviceContractRegistrySchema)
  .default({});
export type ServiceContractRegistryMap = z.infer<typeof serviceContractRegistryMapSchema>;
