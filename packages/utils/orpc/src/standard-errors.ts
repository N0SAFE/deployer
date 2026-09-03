import z from "zod/v4";
import { ORPCError } from "@orpc/client";
import type { ErrorDefinitionBuilder } from "./builder/core/error-builder";

/**
 * Shared wire payload for product-domain (non-mesh) ORPC errors.
 * Mirrors `meshDomainErrorPayloadSchema` so the HTTP exception filter and
 * the typed client agree on the shape.
 */
export const standardDomainErrorPayloadSchema = z.object({
    statusCode: z.number(),
    code: z.string(),
    message: z.string(),
    orpcCode: z.string(),
});

export type StandardDomainErrorPayload = z.infer<typeof standardDomainErrorPayloadSchema>;

/**
 * The canonical ORPC error codes for product domains (project, service,
 * deployment, domain, docker, ...). Codes are the standard ORPC strings so
 * the typed client surfaces `error.code` / `error.status` / `error.data`
 * uniformly across every domain.
 */
export const STANDARD_DOMAIN_ORPC_CODE = {
    not_found: "NOT_FOUND",
    validation: "BAD_REQUEST",
    conflict: "CONFLICT",
    unauthorized: "UNAUTHORIZED",
    forbidden: "FORBIDDEN",
    dependency_missing: "FAILED_DEPENDENCY",
} as const;

export const STANDARD_DOMAIN_HTTP_STATUS = {
    not_found: 404,
    validation: 400,
    conflict: 409,
    unauthorized: 401,
    forbidden: 403,
    dependency_missing: 424,
} as const;

/**
 * Ready-to-pass options for typed ORPC errors.
 *
 * ```ts
 * // Handler with typed errors parameter:
 * throw errors.NOT_FOUND(standardErrorOptions("not_found", "Project not found"));
 * // Raw ORPCError escape hatch (code/data still match the contract):
 * throw new ORPCError("NOT_FOUND", standardErrorOptions("not_found", "Project not found"));
 * ```
 */
export function standardErrorOptions(
    kind: keyof typeof STANDARD_DOMAIN_ORPC_CODE,
    message: string,
): { status: number; message: string; data: StandardDomainErrorPayload } {
    return domainErrorOptions(STANDARD_DOMAIN_ORPC_CODE[kind], STANDARD_DOMAIN_HTTP_STATUS[kind], message);
}

/**
 * Same as {@link standardErrorOptions} but for any explicitly declared
 * ORPC code + HTTP status pair (e.g. gateway codes such as `BAD_GATEWAY`
 * that contracts declare next to the standard spread).
 *
 * ```ts
 * throw errors.BAD_GATEWAY(domainErrorOptions("BAD_GATEWAY", 502, "Mesh node failed"));
 * ```
 */
export function domainErrorOptions(
    orpcCode: string,
    statusCode: number,
    message: string,
): { status: number; message: string; data: StandardDomainErrorPayload } {
    return {
        status: statusCode,
        message,
        data: { statusCode, code: orpcCode, message, orpcCode },
    };
}

/**
 * Canonical per-code error definitions for the standard product-domain
 * errors. Keyed by the ORPC code, carrying the same message/status/data
 * triple the contracts declare via `standardDomainErrorContracts`. Used
 * to declare `.errors(...)` on ORPC middlewares and to build
 * `standardErrorActions`.
 */
export const STANDARD_DOMAIN_ERROR_DEFS = {
    [STANDARD_DOMAIN_ORPC_CODE.not_found]: {
        message: "Resource not found",
        status: STANDARD_DOMAIN_HTTP_STATUS.not_found,
        data: standardDomainErrorPayloadSchema,
    },
    [STANDARD_DOMAIN_ORPC_CODE.validation]: {
        message: "Invalid input",
        status: STANDARD_DOMAIN_HTTP_STATUS.validation,
        data: standardDomainErrorPayloadSchema,
    },
    [STANDARD_DOMAIN_ORPC_CODE.conflict]: {
        message: "Conflict",
        status: STANDARD_DOMAIN_HTTP_STATUS.conflict,
        data: standardDomainErrorPayloadSchema,
    },
    [STANDARD_DOMAIN_ORPC_CODE.unauthorized]: {
        message: "Unauthorized",
        status: STANDARD_DOMAIN_HTTP_STATUS.unauthorized,
        data: standardDomainErrorPayloadSchema,
    },
    [STANDARD_DOMAIN_ORPC_CODE.forbidden]: {
        message: "Forbidden",
        status: STANDARD_DOMAIN_HTTP_STATUS.forbidden,
        data: standardDomainErrorPayloadSchema,
    },
    [STANDARD_DOMAIN_ORPC_CODE.dependency_missing]: {
        message: "Dependency missing",
        status: STANDARD_DOMAIN_HTTP_STATUS.dependency_missing,
        data: standardDomainErrorPayloadSchema,
    },
} as const;

/**
 * Closed-set throwable factories for the standard domain errors.
 *
 * For code paths WITHOUT access to the ORPC `errors` property (services,
 * repositories, utility classes), this is the sanctioned way to throw a
 * domain error — the ORPC Compatibility pattern from the oRPC docs. The
 * code/status/data triple always matches what contracts declare via
 * `standardDomainErrorContracts`, so the runtime upgrades the throw to a
 * DEFINED (typed) error on the client. The set is CLOSED: the only codes
 * throwable here are the ones every contract declares, so an off-contract
 * error cannot be produced.
 *
 * ```ts
 * import { standardErrorActions } from "@repo/orpc-utils";
 * throw standardErrorActions.NOT_FOUND("User not found");
 * ```
 */
export const standardErrorActions = {
    NOT_FOUND: (message: string) =>
        new ORPCError(STANDARD_DOMAIN_ORPC_CODE.not_found, standardErrorOptions("not_found", message)),
    BAD_REQUEST: (message: string) =>
        new ORPCError(STANDARD_DOMAIN_ORPC_CODE.validation, standardErrorOptions("validation", message)),
    CONFLICT: (message: string) =>
        new ORPCError(STANDARD_DOMAIN_ORPC_CODE.conflict, standardErrorOptions("conflict", message)),
    UNAUTHORIZED: (message: string) =>
        new ORPCError(STANDARD_DOMAIN_ORPC_CODE.unauthorized, standardErrorOptions("unauthorized", message)),
    FORBIDDEN: (message: string) =>
        new ORPCError(STANDARD_DOMAIN_ORPC_CODE.forbidden, standardErrorOptions("forbidden", message)),
    FAILED_DEPENDENCY: (message: string) =>
        new ORPCError(
            STANDARD_DOMAIN_ORPC_CODE.dependency_missing,
            standardErrorOptions("dependency_missing", message),
        ),
} as const;

export type StandardErrorAction = (message: string) => ORPCError<string, StandardDomainErrorPayload>;

/**
 * Attach the canonical product-domain errors to an ORPC contract.
 *
 * Every contract that can throw a domain error should declare these so the
 * typed ORPC client gets a typed catch path (`error.code`, `error.status`,
 * `error.data`). Add domain-specific errors AFTER the spread:
 *
 * ```ts
 * .errors((e) => [
 *   ...standardDomainErrorContracts(e),
 *   e("NOT_FOUND").message("Project not found").status(404).data(z.object({ id: z.uuid() })),
 * ])
 * ```
 */
export function standardDomainErrorContracts(
    e: (code?: string) => ErrorDefinitionBuilder,
) {
    return [
        e()
            .code(STANDARD_DOMAIN_ORPC_CODE.not_found)
            .message("Resource not found")
            .status(STANDARD_DOMAIN_HTTP_STATUS.not_found)
            .data(standardDomainErrorPayloadSchema),
        e()
            .code(STANDARD_DOMAIN_ORPC_CODE.validation)
            .message("Invalid input")
            .status(STANDARD_DOMAIN_HTTP_STATUS.validation)
            .data(standardDomainErrorPayloadSchema),
        e()
            .code(STANDARD_DOMAIN_ORPC_CODE.conflict)
            .message("Conflict")
            .status(STANDARD_DOMAIN_HTTP_STATUS.conflict)
            .data(standardDomainErrorPayloadSchema),
        e()
            .code(STANDARD_DOMAIN_ORPC_CODE.unauthorized)
            .message("Unauthorized")
            .status(STANDARD_DOMAIN_HTTP_STATUS.unauthorized)
            .data(standardDomainErrorPayloadSchema),
        e()
            .code(STANDARD_DOMAIN_ORPC_CODE.forbidden)
            .message("Forbidden")
            .status(STANDARD_DOMAIN_HTTP_STATUS.forbidden)
            .data(standardDomainErrorPayloadSchema),
        e()
            .code(STANDARD_DOMAIN_ORPC_CODE.dependency_missing)
            .message("Dependency missing")
            .status(STANDARD_DOMAIN_HTTP_STATUS.dependency_missing)
            .data(standardDomainErrorPayloadSchema),
    ] as const;
}
