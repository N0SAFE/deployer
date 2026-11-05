// oRPC v2 moved these from `@orpc/nest` to `@orpc/server`. `@orpc/nest` no
// longer re-exports them, so the import must name the package that declares
// them.
import { ValidationError } from '@orpc/contract'
import { onError, ORPCError } from '@orpc/server'
import zod from 'zod/v4'

import { AppError } from '@deployer/errors'

import { MeshBaseDomainError } from '../../mesh/shared/domain/mesh-base-error'

import type { InternalErrorInsightServiceShape } from '../../../middlewares/internal-error/internal-error-insight.service'
import type { Logger } from '@nestjs/common'
import type { ORPCErrorCode } from '@orpc/client'
import type { Interceptor } from '@orpc/shared'

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
        // v2 removed `status` from ORPCError options: the HTTP status is mapped
        // from the code by the handler's `errorStatusMap`. The status is still
        // sent to clients through `data.statusCode`.
        throw new ORPCError(error.orpcCode, {
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
 * Transforms `@deployer/errors` AppError to ORPCError
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * A domain object throws `NotFoundError`/`ForbiddenError`/`ConflictError` rather
 * than a NestJS `NotFoundException`, because the domain must not import
 * `@nestjs/common` — it is shared with workers, tests and (increasingly) the
 * contracts. That leaves the transport with the job of turning it into the right
 * status. `AppError` carries `httpStatus` and `orpcCode` for exactly this reason.
 *
 * Emitting the same `data` shape as the NestJS branch matters: ORPC marks a thrown
 * error as "defined" (typed on the client) ONLY when its data validates the
 * contract's declared schema, so a different shape would downgrade every
 * entity-thrown error to an unknown one on the web app.
 *
 * MUST RUN LAST: a `ValidationError` from `@orpc/contract` is unrelated (oRPC's
 * own input/output validation) and is handled by the NestJS branch, so checking
 * `AppError` after it keeps the two apart.
 */
export function transformAppErrorToORPCError(error: unknown): void {
    if (error instanceof AppError) {
        throw new ORPCError(toOrpcErrorCode(error.orpcCode), {
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

/** Narrow an arbitrary `orpcCode` string to the union oRPC accepts. */
function toOrpcErrorCode(code: string): ORPCErrorCode {
    return code
}

/**
 * ORPC interceptor that transforms MeshBaseDomainError and `@deployer/errors` AppError into ORPCError
 * This ensures proper HTTP status codes are returned instead of generic 500 errors. (Nothing throws a NestJS
 * `HttpException` inside a procedure any more: failures are tagged domain errors, mapped by `domainErrorInterceptor`.)
 *
 * @example
 * ```ts
 * ORPCModule.forRootAsync({
 *   useFactory: () => ({
 *     interceptors: [
 *       transformDomainErrorToOrpcError(),
 *     ],
 *   }),
 * })
 * ```
 */
// oRPC bounds `Interceptor`'s generics to its own context types, which `unknown` does not satisfy; the function is
// generic over the caller's context by construction.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transformDomainErrorToOrpcError(): Interceptor<any, any> {
    return onError((error: unknown) => {
        transformMeshDomainErrorToORPCError(error)
        transformAppErrorToORPCError(error)
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
    internalErrorInsightService?: InternalErrorInsightServiceShape
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
                                ),
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
