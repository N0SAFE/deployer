import { implement } from "@orpc/server";
import type { InferClientError } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import { Effect } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import { contract } from "../src/contracts";
import { PlanetServiceImpl } from "../src/modules/planet/services/planet.service";
import { PlanetNameConflict } from "../src/modules/planet/errors/planet-name-conflict";

type Client = ContractRouterClient<typeof contract>;
type CodeOf<T> = T extends { readonly code: infer C } ? C : never;

describe("contract ⇄ Effect error types", () => {
  it("keeps the Effect error channel aligned with the domain error", () => {
    type CreateEffect = ReturnType<PlanetServiceImpl["create"]>;

    expectTypeOf<Effect.Error<CreateEffect>>().toEqualTypeOf<PlanetNameConflict>();
  });

  it("exposes only declared errors to the client", () => {
    expectTypeOf<CodeOf<InferClientError<Client["planet"]["create"]>>>().toEqualTypeOf<
      "CONFLICT" | "UNAUTHORIZED"
    >();
    expectTypeOf<CodeOf<InferClientError<Client["planet"]["findById"]>>>().toEqualTypeOf<"NOT_FOUND">();
    expectTypeOf<CodeOf<InferClientError<Client["auth"]["me"]>>>().toEqualTypeOf<"UNAUTHORIZED">();
  });

  it("rejects error constructors the contract does not declare", () => {
    const procedure = implement(contract.planet.list).handler(({ errors }) => {
      // @ts-expect-error LIST declares no errors, so CONFLICT does not exist.
      return errors.CONFLICT({ data: { name: "Earth" } });
    });

    expect(procedure).toBeDefined();
  });

  it("rejects error data that does not match the contract schema", () => {
    const procedure = implement(contract.planet.findById).handler(({ errors }) => ({
      id: "earth",
      name: "Earth",
      description: null,
      discoveredAt: new Date(0).toISOString(),
      // @ts-expect-error NOT_FOUND data is { id: string }.
      invalid: errors.NOT_FOUND({ data: { wrong: 1 } }),
    }));

    expect(procedure).toBeDefined();
  });
});
