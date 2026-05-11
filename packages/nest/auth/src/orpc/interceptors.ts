import type { Logger } from '@nestjs/common';
import { HttpException } from '@nestjs/common'
import { onError, ORPCError } from '@orpc/nest'
import type { ORPCErrorCode } from '@orpc/client'
import type { Interceptor } from '@orpc/shared'
import { ValidationError } from '@orpc/contract'
import zod from 'zod/v4'
import type { InternalErrorInsightService } from '@/core/middlewares/internal-error/internal-error-insight.service'

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
 * Transforms NestJS HttpException to ORPCError
 * This allows proper HTTP status codes to be returned instead of 500
 */
export function transformHttpExceptionToORPCError(error: unknown): void {
    if (error instanceof HttpException) {
        const status = error.getStatus()
        const response = error.getResponse()
        const message =
            typeof response === 'string'
                ? response
                : ((response as { message?: string }).message ?? error.message)

        throw new ORPCError(httpStatusToORPCCode(status), {
            status,
            message,
            data: typeof response === 'object' ? response : undefined,
            cause: error,
        })
    }
}

/**
 * ORPC interceptor that transforms NestJS HttpException errors to ORPCError
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
        }
    })
}
