"use client";

import { isDefinedError, ORPCError } from "@orpc/client";
import { standardDomainErrorPayloadSchema } from "@repo/orpc-utils";

/**
 * A DEFINED ORPC error (one the contract declares).
 *
 * Mirrors the web app's helper: the raw `isDefinedError` narrows via
 * `Extract<T, ORPCError>`, which collapses to `never` for `unknown` — so it
 * cannot be used directly at a catch site. This checks `instanceof` first and
 * narrows to the ORPCError, making `error.code` / `error.data` accessible.
 */
export function isDefinedORPCError(error: unknown): error is ORPCError<string, unknown> {
  return isDefinedError(error);
}

/** Fallback copy for an error the contract does not describe. */
export const UNKNOWN_ORPC_ERROR_MESSAGE =
  "Something went wrong. Please try again.";

/** Human-readable message for any error (mirror of the web's getErrorMessage). */
export function getErrorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (error instanceof ORPCError && isDefinedError(error)) {
    const parsed = standardDomainErrorPayloadSchema.safeParse(error.data);
    if (parsed.success && parsed.data.message) return parsed.data.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}