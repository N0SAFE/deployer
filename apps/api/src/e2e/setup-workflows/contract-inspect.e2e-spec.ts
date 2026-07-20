import { describe, it, expect } from 'vitest'
import { setupContract } from "@repo/api-contracts";
import { isContractProcedure, getEventIteratorSchemaDetails } from "@orpc/contract";

describe("contract observable detection", () => {
  const endpoints = ["initialize", "getInitializeStream"];

  for (const name of endpoints) {
    it(`${name} should be detectable as observable by ObservableLinkPlugin`, () => {
      const proc = (setupContract as Record<string, unknown>)[name];
      expect(isContractProcedure(proc)).toBe(true);

      const orpc = (proc as { "~orpc": Record<string, unknown> })["~orpc"];
      const outputSchema = orpc?.outputSchema as Record<string, unknown> | undefined;
      expect(outputSchema).toBeDefined();

      // Check getEventIteratorSchemaDetails (what ObservableLinkPlugin checks)
      const ei = getEventIteratorSchemaDetails(outputSchema);
      expect(ei).toBeDefined();
      
      // Also check for OBSERVABLE_DETAILS_SYMBOL on ~standard
      const standard = (outputSchema as Record<string, unknown>)["~standard"] as Record<PropertyKey, unknown> | undefined;
      expect(standard).toBeDefined();
      
      const symbols = Object.getOwnPropertySymbols(standard!);
      const hasObsSymbol = symbols.some(s => s.toString().includes("OBSERVABLE"));
      expect(hasObsSymbol).toBe(true);
      
      console.log(`${name}: OK — getEventIteratorSchemaDetails=${!!ei}, hasObsSymbol=${hasObsSymbol}`);
    });
  }
});
