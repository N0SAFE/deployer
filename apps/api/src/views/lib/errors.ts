"use client";

import { isDefinedError, ORPCError } from "@orpc/client";
import { standardDomainErrorPayloadSchema } from "@repo/orpc-utils";

/** Human-readable message for any error (mirror of the web's getErrorMessage). */
export function getErrorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (error instanceof ORPCError && isDefinedError(error)) {
    const parsed = standardDomainErrorPayloadSchema.safeParse(error.data);
    if (parsed.success && parsed.data.message) return parsed.data.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}