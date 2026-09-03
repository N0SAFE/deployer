import { isDefinedError, ORPCError } from "@orpc/client";
import {
    standardDomainErrorPayloadSchema,
    type StandardDomainErrorPayload,
} from "@repo/orpc-utils";

export { isDefinedError };

/**
 * Proper type guard for DEFINED ORPC errors.
 *
 * The raw `isDefinedError` from `@orpc/client` narrows via
 * `Extract<T, ORPCError>` which collapses to `never` for `unknown` — so it
 * cannot be used directly at catch sites. This wrapper checks `instanceof`
 * first and narrows to the ORPCError, letting consumers access
 * `error.code` / `error.status` / `error.data` safely inside the branch.
 *
 * ```ts
 * catch (error) {
 *   if (isDefinedORPCError(error)) {
 *     // error.code, error.status, error.data — typed
 *   } else {
 *     // network failure / unhandled 5xx — handle the unknown case
 *   }
 * }
 * ```
 */
export function isDefinedORPCError(error: unknown): error is ORPCError<string, unknown> {
    return error instanceof ORPCError && isDefinedError(error);
}

export type DomainErrorCode = StandardDomainErrorPayload["code"];

/**
 * Narrow a thrown ORPC client error to the standard domain-error payload.
 *
 * The API forwards every domain failure as an ORPC builtin error whose data
 * validates against `standardDomainErrorPayloadSchema`
 * (`{ statusCode, code, message, orpcCode }`) — see
 * `standardErrorOptions` / `domainErrorOptions` on the API side and
 * `.errors(standardDomainErrorContracts(e))` on every contract.
 *
 * Usage:
 * ```ts
 * try {
 *     await orpc.project.create.mutationOptions()...
 * } catch (error) {
 *     const payload = getDomainErrorPayload(error);
 *     if (payload) {
 *         // Typed: payload.code / payload.message / payload.statusCode
 *     } else if (isDefinedError(error)) {
 *         // Defined but non-standard payload — inspect error.code/error.data
 *     } else {
 *         // Unknown error (network, unhandled 500, ...)
 *     }
 * }
 * ```
 */
export function getDomainErrorPayload(error: unknown): StandardDomainErrorPayload | null {
    // `isDefinedError` narrows via Extract<T, ORPCError>, which collapses to
    // `never` for plain `unknown` — so check instanceof first.
    if (!(error instanceof ORPCError) || !isDefinedError(error)) return null;

    const parsed = standardDomainErrorPayloadSchema.safeParse(error.data);
    return parsed.success ? parsed.data : null;
}

/**
 * Type guard for domain errors, optionally constrained to specific error
 * codes. Lets call sites branch on the CANONICAL code — e.g. show a
 * different message for CONFLICT vs NOT_FOUND vs UNAUTHORIZED — while
 * narrowing `error.data` to the typed standard payload inside the branch.
 *
 * ```ts
 * if (isDomainError(error, "CONFLICT")) {
 *   error.data // StandardDomainErrorPayload, code === "CONFLICT"
 * }
 * if (isDomainError(error, ["NOT_FOUND", "FAILED_DEPENDENCY"])) { ... }
 * ```
 */
export function isDomainError(
    error: unknown,
    code?: DomainErrorCode | readonly DomainErrorCode[],
): error is ORPCError<string, StandardDomainErrorPayload> {
    const payload = getDomainErrorPayload(error);
    if (!payload) return false;
    if (code === undefined) return true;
    const codes = Array.isArray(code) ? code : [code];
    return codes.some((c) => c === payload.code);
}

/**
 * Human-readable message for any error, preferring the canonical
 * domain-error payload message (what the API sent), falling back to
 * `error.message`, then the provided fallback. Safe to render directly.
 */
export function getErrorMessage(error: unknown, fallback = "Something went wrong"): string {
    const payload = getDomainErrorPayload(error);
    if (payload?.message) return payload.message;
    if (error instanceof Error && error.message) return error.message;
    return fallback;
}

/**
 * Standard message for the UNKNOWN error case (non-defined ORPC error —
 * network failure, unhandled 5xx, ...). Lets every consumer "handle all the
 * cases" with one canonical unknown-fallback string.
 */
export const UNKNOWN_ORPC_ERROR_MESSAGE =
    "An unexpected error occurred. Please check your connection and try again.";

/**
 * The canonical ORPC error code (`NOT_FOUND`, `CONFLICT`, ...) for a
 * DEFINED error, or null for unknown/network errors. Useful when the code
 * is needed as a value (keys, analytics, sentry tags).
 */
export function getErrorType(error: unknown): string | null {
    const payload = getDomainErrorPayload(error);
    if (payload) return payload.code;
    if (error instanceof ORPCError && isDefinedError(error)) {
        return error.code;
    }
    return null;
}
