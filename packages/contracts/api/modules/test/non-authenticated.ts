import z from "zod/v4";
import { standard } from "@repo/orpc-utils";

const testNonAuthenticatedOps = standard.zod(
  z.object({ ok: z.boolean(), message: z.string().optional() }),
  "testNonAuthenticated",
);

/**
 * Test contract for non-authenticated ORPC endpoint
 * This contract demonstrates a simple GET request without authentication
 */
export const testNonAuthenticatedContract = testNonAuthenticatedOps
  .list()
  .path("/non-authenticated")
  .input(z.object({}))
  .output(
    z.object({
      ok: z.boolean(),
      message: z.string().optional(),
    })
  )
  .build();

// Define types based on schemas
export type TestNonAuthenticatedInput = Record<string, never>;
export type TestNonAuthenticatedOutput = {
  ok: boolean;
  message?: string;
};
