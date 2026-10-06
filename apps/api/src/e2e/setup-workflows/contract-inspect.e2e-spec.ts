import { describe, it, expect } from 'vitest'
// These procedures belong to the SETUP APP, not the API, and live on
// `setupAppContract`: the setup app is what runs and reports the startup steps.
import { setupAppContract } from "@repo/api-contracts";
// oRPC v2 renamed both helpers:
//   `isContractProcedure`             -> the contract check is now a brand test
//   `getEventIteratorSchemaDetails`   -> `getAsyncIteratorObjectSchemaDetails`
//     (`eventIterator` itself was renamed to `asyncIteratorObject`)
import { getAsyncIteratorObjectSchemaDetails } from "@orpc/contract";

type EventIteratorSchemaArg = Parameters<typeof getAsyncIteratorObjectSchemaDetails>[0];

const contract = setupAppContract as unknown as Record<string, unknown>;

/**
 * The `~orpc` descriptor's output schema.
 *
 * oRPC v2 stores schemas as ARRAYS (`inputSchemas` / `outputSchemas`) and the
 * builder applies exactly one of each, so index 0 is the schema. Reading a
 * singular `outputSchema` — as this test used to — yields `undefined` against a
 * real v2 contract. This mirrors `ObservableLinkPlugin`, which is the code this
 * test exists to guard.
 */
function outputSchemaOf(name: string): NonNullable<EventIteratorSchemaArg> {
  const proc = contract[name] as { "~orpc"?: { outputSchemas?: unknown[] } } | undefined;
  const orpc = proc?.["~orpc"];
  expect(orpc, `${name} should expose a ~orpc descriptor`).toBeDefined();
  const outputSchema = orpc?.outputSchemas?.[0] as EventIteratorSchemaArg | undefined;
  expect(outputSchema, `${name} should declare an output schema`).toBeDefined();
  return outputSchema!;
}

describe("contract observable detection", () => {
  it("getInitializeStream should be detectable as observable by ObservableLinkPlugin", () => {
    // The STREAM is the observable: `triggerInitialize` only accepts the trigger
    // and answers `{accepted, delivered}`, so an observable assertion on it could
    // never hold. This test used to name it `initialize`, a key that no longer
    // exists on either contract, which is why it read `undefined`.
    const outputSchema = outputSchemaOf("getInitializeStream");

    // The two markings ObservableLinkPlugin accepts as "observable".
    const standard = Reflect.get(outputSchema, "~standard");
    expect(standard).toBeDefined();
    const hasObsSymbol = Object.getOwnPropertySymbols(standard!).some((s) =>
      s.toString().includes("OBSERVABLE"),
    );
    const hasEventIterator = getAsyncIteratorObjectSchemaDetails(outputSchema) !== undefined;

    expect(hasObsSymbol || hasEventIterator).toBe(true);
  });

  it("triggerInitialize is NOT observable (it is the trigger, not the stream)", () => {
    // Pinned so the two are not confused again: the trigger must stay a plain
    // call whose result reports acceptance, never an observable.
    expect(getAsyncIteratorObjectSchemaDetails(outputSchemaOf("triggerInitialize"))).toBeUndefined();
  });
});
