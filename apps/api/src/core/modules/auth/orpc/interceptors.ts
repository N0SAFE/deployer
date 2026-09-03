import type { Logger } from '@nestjs/common';
import { HttpException } from '@nestjs/common'
import { onError, ORPCError } from '@orpc/nest'
import type { ORPCErrorCode } from '@orpc/client'
import type { Interceptor } from '@orpc/shared'
import { ValidationError } from '@orpc/contract'
import zod from 'zod/v4'
import type { InternalErrorInsightService } from '@/core/middlewares/internal-error/internal-error-insight.service'
import { MeshBaseDomainError } from '@/core/modules/mesh/shared/domain/mesh-base-error'

/**
 * Maps NestJS HTTP status codes to ORPC error codes
 */
export function httpStatusToORPCCode(status: number): ORPCErrorCode {
    switch (status) {
        case 400:
            return 'BAD_REQUEST'
        case 401:
            return 'UNAUTHORIZED'
        case 403:
            return 'FORBIDDEN'
        case 404:
            return 'NOT_FOUND'
        case 405:
            return 'METHOD_NOT_SUPPORTED'
        case 408:
            return 'TIMEOUT'
        case 409:
            return 'CONFLICT'
        case 413:
            return 'PAYLOAD_TOO_LARGE'
        case 415:
            return 'UNSUPPORTED_MEDIA_TYPE'
        case 422:
            return 'UNPROCESSABLE_CONTENT'
        case 429:
            return 'TOO_MANY_REQUESTS'
        case 499:
            return 'CLIENT_CLOSED_REQUEST'
        case 501:
            return 'NOT_IMPLEMENTED'
        case 502:
            return 'BAD_GATEWAY'
        case 503:
            return 'SERVICE_UNAVAILABLE'
        case 504:
            return 'GATEWAY_TIMEOUT'
        default:
            return status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST'
    }
}

/**
 * Extract a single human-readable message from a NestJS exception response.
 * Validation pipes produce `string[]` messages — join them so the wire
 * payload always satisfies `standardDomainErrorPayloadSchema` (`message:
 * string`).
 */
function resolveExceptionMessage(response: unknown, fallback: string): string {
    if (typeof response === 'string') return response
    if (typeof response === 'object' && response !== null && 'message' in response) {
        const message = (response as { message?: unknown }).message
        if (typeof message === 'string') return message
        if (Array.isArray(message)) return message.filter(m => typeof m === 'string').join('; ')
    }
    return fallback
}

/**
 * Transforms NestJS HttpException to ORPCError
 *
 * The emitted `data` payload mirrors `standardDomainErrorPayloadSchema`
 * (`{ statusCode, code, message, orpcCode }`) — the exact shape every
 * contract declares via `.errors(standardDomainErrorContracts(e))`. ORPC
 * marks a thrown error as "defined" (typed on the client) ONLY when its
 * data validates against the contract's declared schema, so deviating from
 * this shape would downgrade every service-thrown exception to an unknown
 * error on the web app.
 *
 * This allows proper HTTP status codes to be returned instead of 500.
 */
export function transformHttpExceptionToORPCError(error: unknown): void {
    if (error instanceof HttpException) {
        const status = error.getStatus()
        const orpcCode = httpStatusToORPCCode(status)
        const message = resolveExceptionMessage(error.getResponse(), error.message)

        throw new ORPCError(orpcCode, {
            status,
            message,
            data: {
                statusCode: status,
                code: orpcCode,
                message,
                orpcCode,
            },
            cause: error,
        })
    }
}

/**
 * Transforms MeshBaseDomainError to ORPCError
 *
 * Mesh domain errors carry their own `httpStatus` / `orpcCode` fields. The
 * emitted `data` payload mirrors `meshDomainErrorPayloadSchema`
 * (`{ statusCode, code, message, orpcCode }`) — the shape mesh contracts
 * declare via `.errors(meshDomainErrorContracts(e))` — so the typed client
 * receives them as DEFINED errors instead of unknown ones.
 */
export function transformMeshDomainErrorToORPCError(error: unknown): void {
    if (error instanceof MeshBaseDomainError) {
        throw new ORPCError(error.orpcCode, {
            status: error.httpStatus,
            message: error.message,
            data: {
                statusCode: error.httpStatus,
                code: error.code,
                message: error.message,
                orpcCode: error.orpcCode,
            },
            cause: error,
        })
    }
}

/**
 * ORPC interceptor that transforms NestJS HttpException and
 * MeshBaseDomainError errors to ORPCError
 * This ensures proper HTTP status codes are returned instead of generic 500 errors
 *
 * @example
 * ```ts
 * ORPCModule.forRootAsync({
 *   useFactory: () => ({
 *     interceptors: [
 *       transformNestJSErrorToOrpcError(),
 *     ],
 *   }),
 * })
 * ```
 */
export function transformNestJSErrorToOrpcError(): Interceptor<any, any> {
    return onError((error: unknown) => {
        transformHttpExceptionToORPCError(error)
        transformMeshDomainErrorToORPCError(error)
    })
}

/**
 * ORPC interceptor that logs errors to console
 * Useful for debugging and monitoring
 *
 * @example
 * ```ts
 * ORPCModule.forRootAsync({
 *   useFactory: () => ({
 *     interceptors: [
 *       logOrpcErrors(),
 *     ],
 *   }),
 * })
 * ```
 */
export function logOrpcErrors(
    logger: Logger,
    internalErrorInsightService?: InternalErrorInsightService,
): Interceptor<any, any> {
    return onError((error: unknown) => {
        if (error instanceof ORPCError) {
            const isInternalServerError = error.code === 'INTERNAL_SERVER_ERROR'
            const traceId = isInternalServerError
                ? internalErrorInsightService?.capture(error, {
                    source: 'orpc',
                }).traceId
                : undefined

            switch (error.code) {
                case 'BAD_REQUEST':
                case 'INTERNAL_SERVER_ERROR': {
                    if (error.cause instanceof ValidationError) {
                        const zodError = new zod.ZodError(
                            error.cause.issues as zod.core.$ZodIssue[]
                        )
                        logger.error(
                            `Validation Error [${error.code === 'BAD_REQUEST' ? 'INPUT' : 'OUTPUT'}]:`,
                            {
                                traceId,
                                prettified: zod.prettifyError(zodError),
                                ...Object.fromEntries(
                                    Object.entries(
                                        Object.getOwnPropertyDescriptors(error)
                                    ).map(([key, desc]) => [
                                        key,
                                        'value' in desc ? desc.value : desc,
                                    ])
                                )
                            }
                        )
                    }
                    break
                }
                default:
                    logger.error(
                        `Error [${String(error.code)}]${traceId ? ` [trace:${traceId}]` : ''}:`,
                        Object.fromEntries(
                            Object.entries(
                                Object.getOwnPropertyDescriptors(error)
                            ).map(([key, desc]) => [
                                key,
                                'value' in desc ? desc.value : desc,
                            ])
                        )
                    )
                    break
            }
        } else if (error instanceof Error) {
            // Fallback: log any non-ORPCError that wasn't transformed
            const traceId = internalErrorInsightService?.capture(error, {
                source: 'orpc',
            }).traceId
            logger.error(
                `Unhandled error [${error.constructor.name}]${traceId ? ` [trace:${traceId}]` : ''}: ${error.message}`,
                {
                    traceId,
                    stack: error.stack,
                    name: error.constructor.name,
                    message: error.message,
                }
            )
        }
    })
}
