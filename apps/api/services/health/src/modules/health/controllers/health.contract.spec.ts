import type { InferClientError } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import { describe, expectTypeOf, it } from "vitest";

import { healthContract } from "@deployer/health-contracts";

type Client = ContractRouterClient<typeof healthContract>;
type CodeOf<T> = T extends { readonly code: infer C } ? C : never;

/**
 * Compile-time guarantee: the health procedures expose exactly the standard
 * domain errors declared by `standardDomainErrorContracts`, so the mapping in
 * `HealthController` cannot drift from what the client can catch.
 */
describe("health contract errors", () => {
  it("exposes the typed domain error union to the client", () => {
    expectTypeOf<CodeOf<InferClientError<Client["check"]>>>().toEqualTypeOf<
      | "NOT_FOUND"
      | "BAD_REQUEST"
      | "CONFLICT"
      | "UNAUTHORIZED"
      | "FORBIDDEN"
      | "FAILED_DEPENDENCY"
    >();
  });
});
