import z from "zod/v4";
import { standard } from "@repo/orpc-utils";

const testAuthenticatedOps = standard.zod(
  z.object({ ok: z.boolean(), userId: z.string().optional(), message: z.string().optional() }),
  "testAuthenticated",
);

/**
 * Test contract for authenticated ORPC endpoint
 * This contract demonstrates a simple GET request that requires authentication
 */
export const testAuthenticatedContract = testAuthenticatedOps
  .list()
  .path("/authenticated")
  .input(z.object({}))
  .output(
    z.object({
      ok: z.boolean(),
      userId: z.string().optional(),
      message: z.string().optional(),
    })
  )
  .build();

// Define types based on schemas
export type TestAuthenticatedInput = Record<string, never>;
export type TestAuthenticatedOutput = {
  ok: boolean;
  userId?: string;
  message?: string;
};
