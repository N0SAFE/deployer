import z from "zod/v4";

/**
 * CONTRACT IMPLEMENTATION (dependency-injection semantics at deploy level).
 *
 * A service declares WHICH contract it implements. Mocks are replacement
 * implementations of the SAME contract — the platform validates a mock swap by
 * matching `contractRef` (like DI validating an interface).
 *
 * Both real services and mocks declare this. Example:
 *   api (NestJS)      → implements: { contractRef: "api.oas3" }
 *   api-stub (repo)   → implements: { contractRef: "api.oas3" }  // DI-style mock
 *   api-mock (prism)  → implements: { contractRef: "api.oas3" }  // spec-driven mock
 */
export const implementedContractSchema = z.object({
  /** Contract id resolved from the contract registry, e.g. "api.oas3". */
  contractRef: z.string().min(1),
  /** Transport compatibility — prevents linking an HTTP mock to an events consumer. */
  compatibility: z.enum(["http", "grpc", "events"]).default("http"),
});
export type ImplementedContract = z.infer<typeof implementedContractSchema>;

/**
 * MOCK RUNNER CONFIG (spec-driven flavor).
 *
 * A `mock` runner generates a replacement service from a contract/fixtures —
 * no application code needed. This is Flavor A from the POC; Flavor B
 * (DI-style code replacement) is a NORMAL service row (docker/static runner)
 * that additionally declares `implementsContract` on the service entity.
 *
 * Engines:
 *  - prism:       Stoplight Prism — OpenAPI/Postman spec → auto-generated responses
 *  - wiremock:    WireMock — hand-crafted / recorded stub mappings
 *  - json-server: fake REST API from a JSON fixture file
 */
export const mockEngineSchema = z.enum(["prism", "wiremock", "json-server"]);
export type MockEngine = z.infer<typeof mockEngineSchema>;

export const mockServiceConfigSchema = z
  .object({
    /** What contract this mock satisfies (proves it can replace the real service). */
    implements: implementedContractSchema,

    /** Mock engine — how responses are generated. */
    engine: mockEngineSchema,

    /** Engine-specific source. Exactly one (validated per engine in the UI). */
    source: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("openapi"), specPath: z.string().min(1) }),
      z.object({ kind: z.literal("stub-dir"), mappingsDir: z.string().min(1) }),
      z.object({ kind: z.literal("db-file"), dbPath: z.string().min(1) }),
      z.object({ kind: z.literal("recorded"), targetUrl: z.string().min(1) }),
    ]),

    /** Response behavior tuning (latency, fault injection). */
    behavior: z
      .object({
        latencyMs: z.number().int().nonnegative().default(0),
        failRatePercent: z.number().min(0).max(100).default(0),
      })
      .default({ latencyMs: 0, failRatePercent: 0 }),

    /** Whether this mock is only present in preview (never in prod). */
    previewOnly: z.boolean().default(true),
  })
  .strict();
export type MockServiceConfig = z.infer<typeof mockServiceConfigSchema>;
