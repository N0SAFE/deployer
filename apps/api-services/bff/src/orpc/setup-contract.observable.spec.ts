import { getAsyncIteratorObjectSchemasDetails, type AnySchema } from "@orpc/contract";
import { setupAppContract } from "@deployer/bff-contracts";
import { describe, expect, it } from "vitest";

const contract = setupAppContract as unknown as Record<string, unknown>;

/**
 * The `~orpc` descriptor's output schemas.
 *
 * oRPC v2 stores schemas as ARRAYS (`inputSchemas` / `outputSchemas`) and its iterator helper
 * takes the array, not one schema (it was `getEventIteratorSchemaDetails(schema)` in v1 and
 * `getAsyncIteratorObjectSchemaDetails(schema)` before beta.46). This mirrors
 * `ObservableLinkPlugin`, the code this spec exists to guard.
 */
function outputSchemasOf(name: string): readonly AnySchema[] {
  const procedure = contract[name] as { "~orpc"?: { outputSchemas?: readonly AnySchema[] } } | undefined;
  const descriptor = procedure?.["~orpc"];
  expect(descriptor, `${name} should expose a ~orpc descriptor`).toBeDefined();
  const outputSchemas = descriptor?.outputSchemas ?? [];
  expect(outputSchemas.length, `${name} should declare an output schema`).toBeGreaterThan(0);
  return outputSchemas;
}

describe("setup contract: which procedures are observable", () => {
  it("getInitializeStream is detectable as observable by ObservableLinkPlugin", () => {
    // The STREAM is the observable: `triggerInitialize` only accepts the trigger and answers
    // `{ accepted, delivered }`.
    const outputSchemas = outputSchemasOf("getInitializeStream");

    // The two markings ObservableLinkPlugin accepts as "observable".
    const standard = Reflect.get(outputSchemas[0] as object, "~standard") as object;
    expect(standard).toBeDefined();
    const hasObservableSymbol = Object.getOwnPropertySymbols(standard).some((s) =>
      s.toString().includes("OBSERVABLE"),
    );
    const hasAsyncIterator = getAsyncIteratorObjectSchemasDetails(outputSchemas) !== undefined;

    expect(hasObservableSymbol || hasAsyncIterator).toBe(true);
  });

  it("triggerInitialize is NOT observable: it is the trigger, not the stream", () => {
    expect(getAsyncIteratorObjectSchemasDetails(outputSchemasOf("triggerInitialize"))).toBeUndefined();
  });
});
