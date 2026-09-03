import z from "zod/v4";
import { ORPCError } from "@orpc/client";
import type { ErrorDefinitionBuilder } from "./builder/core/error-builder";

/**
 * Canonical mesh domain error codes.
 */
export const MESH_ERROR_CODES = [
    "mesh.not_found",
    "mesh.validation",
    "mesh.unauthorized",
    "mesh.trust",
    "mesh.conflict",
    "mesh.dependency_missing",
] as const;

export type MeshErrorCode = (typeof MESH_ERROR_CODES)[number];

/**
 * Mapping from mesh error code to HTTP status code.
 */
export const MESH_ERROR_HTTP_STATUS = {
    "mesh.not_found": 404,
    "mesh.validation": 400,
    "mesh.unauthorized": 403,
    "mesh.trust": 403,
    "mesh.conflict": 409,
    "mesh.dependency_missing": 424,
} as const satisfies Readonly<Record<MeshErrorCode, number>>;

/**
 * Mapping from mesh error code to ORPC error code.
 */
export const MESH_ERROR_ORPC_CODE = {
    "mesh.not_found": "NOT_FOUND",
    "mesh.validation": "BAD_REQUEST",
    "mesh.unauthorized": "FORBIDDEN",
    "mesh.trust": "FORBIDDEN",
    "mesh.conflict": "CONFLICT",
    "mesh.dependency_missing": "FAILED_DEPENDENCY",
} as const satisfies Readonly<Record<MeshErrorCode, string>>;

/**
 * Zod schema for the wire payload of a mesh domain error (without the
 * requestId, which is added by the HTTP exception filter at runtime).
 */
export const meshDomainErrorPayloadSchema = z.object({
    statusCode: z.number(),
    code: z.string(),
    message: z.string(),
    orpcCode: z.string(),
});

export type MeshDomainErrorPayload = z.infer<typeof meshDomainErrorPayloadSchema>;

/**
 * Zod schema for the full mesh error response body (including optional
 * requestId/traceId injected by the exception filter).
 */
export const meshErrorResponseSchema = meshDomainErrorPayloadSchema.extend({
    requestId: z.string().optional(),
    traceId: z.string().optional(),
});

export type MeshErrorResponse = z.infer<typeof meshErrorResponseSchema>;

/**
 * Build a contract-compliant wire payload for a mesh domain error.
 *
 * Mesh contracts spread `meshDomainErrorContracts(e)`, whose declared data
 * schema is `meshDomainErrorPayloadSchema`. ORPC only marks a thrown error
 * as "defined" on the client when its data validates against the declared
 * schema — so every throw site MUST attach this payload.
 *
 * @param code    Canonical mesh error code (e.g. `"mesh.not_found"`).
 * @param message Human-readable message sent to the client.
 */
export function meshDomainErrorPayload(
    code: MeshErrorCode,
    message: string,
): MeshDomainErrorPayload {
    return {
        statusCode: MESH_ERROR_HTTP_STATUS[code],
        code,
        message,
        orpcCode: MESH_ERROR_ORPC_CODE[code],
    };
}

function meshErrorThrow(
    orpcCode: string,
    meshCode: MeshErrorCode,
    message: string,
): ORPCError<string, MeshDomainErrorPayload> {
    return new ORPCError(orpcCode, {
        status: MESH_ERROR_HTTP_STATUS[meshCode],
        message,
        data: meshDomainErrorPayload(meshCode, message),
    });
}

/**
 * Closed-set throwable factories for the mesh domain errors — the ORPC
 * Compatibility pattern (from the oRPC docs) for code paths WITHOUT access
 * to the `errors` property (services, repositories). The code/status/data
 * triple matches what mesh contracts declare via
 * `meshDomainErrorContracts`, so the runtime upgrades the throw to a
 * DEFINED (typed) error on the client; no off-contract code is throwable.
 */
export const meshErrorActions = {
    NOT_FOUND: (message: string) =>
        meshErrorThrow(MESH_ERROR_ORPC_CODE["mesh.not_found"], "mesh.not_found", message),
    BAD_REQUEST: (message: string) =>
        meshErrorThrow(MESH_ERROR_ORPC_CODE["mesh.validation"], "mesh.validation", message),
    FORBIDDEN: (message: string) =>
        meshErrorThrow(MESH_ERROR_ORPC_CODE["mesh.trust"], "mesh.trust", message),
    CONFLICT: (message: string) =>
        meshErrorThrow(MESH_ERROR_ORPC_CODE["mesh.conflict"], "mesh.conflict", message),
    FAILED_DEPENDENCY: (message: string) =>
        meshErrorThrow(
            MESH_ERROR_ORPC_CODE["mesh.dependency_missing"],
            "mesh.dependency_missing",
            message,
        ),
} as const;

/**
 * Helper to attach the canonical mesh domain errors to an ORPC contract.
 * Mirrors the error table used by `InternalErrorExceptionFilter` so the
 * contract surface and the HTTP transport agree on status codes and ORPC
 * error codes.
 */
export function meshDomainErrorContracts(
    e: (code?: string) => ErrorDefinitionBuilder,
) {
    return [
        e()
            .code(MESH_ERROR_ORPC_CODE["mesh.not_found"])
            .message("Mesh resource not found")
            .status(MESH_ERROR_HTTP_STATUS["mesh.not_found"])
            .data(meshDomainErrorPayloadSchema),
        e()
            .code(MESH_ERROR_ORPC_CODE["mesh.validation"])
            .message("Mesh validation error")
            .status(MESH_ERROR_HTTP_STATUS["mesh.validation"])
            .data(meshDomainErrorPayloadSchema),
        e()
            .code(MESH_ERROR_ORPC_CODE["mesh.unauthorized"])
            .message("Mesh authorization error")
            .status(MESH_ERROR_HTTP_STATUS["mesh.unauthorized"])
            .data(meshDomainErrorPayloadSchema),
        e()
            .code(MESH_ERROR_ORPC_CODE["mesh.trust"])
            .message("Mesh trust violation")
            .status(MESH_ERROR_HTTP_STATUS["mesh.trust"])
            .data(meshDomainErrorPayloadSchema),
        e()
            .code(MESH_ERROR_ORPC_CODE["mesh.conflict"])
            .message("Mesh conflict error")
            .status(MESH_ERROR_HTTP_STATUS["mesh.conflict"])
            .data(meshDomainErrorPayloadSchema),
        e()
            .code(MESH_ERROR_ORPC_CODE["mesh.dependency_missing"])
            .message("Mesh dependency missing")
            .status(MESH_ERROR_HTTP_STATUS["mesh.dependency_missing"])
            .data(meshDomainErrorPayloadSchema),
    ] as const;
}
