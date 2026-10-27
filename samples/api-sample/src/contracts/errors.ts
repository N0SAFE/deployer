import { z } from "zod";

/**
 * Errors shared by every authenticated procedure. Declared on the contract and
 * thrown by the `requireSession` middleware with the same key, so the client
 * sees them as defined errors (`isDefinedError`) instead of generic failures.
 */
export const commonErrors = {
  UNAUTHORIZED: {
    message: "Authentication required",
    data: z.object({ reason: z.string().optional() }),
  },
} as const;
