import { z } from "zod/v4";
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
