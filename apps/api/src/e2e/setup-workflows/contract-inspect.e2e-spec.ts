import { describe, it, expect } from 'vitest'
import { setupContract } from "@repo/api-contracts";
// oRPC v2 renamed both helpers:
//   `isContractProcedure`             -> the contract check is now a brand test
//   `getEventIteratorSchemaDetails`   -> `getAsyncIteratorObjectSchemaDetails`
//     (`eventIterator` itself was renamed to `asyncIteratorObject`)
import { getAsyncIteratorObjectSchemaDetails } from "@orpc/contract";

type EventIteratorSchemaArg = Parameters<typeof getAsyncIteratorObjectSchemaDetails>[0];

describe("contract observable detection", () => {
  const endpoints = ["initialize", "getInitializeStream"];

  for (const name of endpoints) {
    it(`${name} should be detectable as observable by ObservableLinkPlugin`, () => {
      const proc = (setupContract as Record<string, unknown>)[name];
      // A procedure contract carries the `~orpc` descriptor; that is what
      // distinguishes it from a plain router entry in v2.
      const orpc = (proc as { "~orpc"?: Record<string, unknown> } | undefined)?.["~orpc"];
      expect(orpc).toBeDefined();

      const outputSchema = orpc?.outputSchema as EventIteratorSchemaArg;
      expect(outputSchema).toBeDefined();

      // Check getAsyncIteratorObjectSchemaDetails (what ObservableLinkPlugin checks)
      const ei = getAsyncIteratorObjectSchemaDetails(outputSchema);
      expect(ei).toBeDefined();

      // Also check for the observable marker on the schema's `~standard`.
      const standard = outputSchema === undefined ? undefined : Reflect.get(outputSchema, "~standard");
      expect(standard).toBeDefined();

      const symbols = Object.getOwnPropertySymbols(standard!);
      const hasObsSymbol = symbols.some(s => s.toString().includes("OBSERVABLE"));
      expect(hasObsSymbol).toBe(true);

      console.log(`${name}: OK — getAsyncIteratorObjectSchemaDetails=${!!ei}, hasObsSymbol=${hasObsSymbol}`);
    });
  }
});
