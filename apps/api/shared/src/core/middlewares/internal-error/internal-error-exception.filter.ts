import {
    Catch,
    HttpException,
    Injectable,
    type ArgumentsHost,
    type ExceptionFilter,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { getInternalErrorRequestContext } from "./internal-error-context";
import { InternalErrorInsightService } from "./internal-error-insight.service";
import { MeshBaseDomainError } from "@/core/modules/mesh/shared/domain/mesh-base-error";
import { isRecord, isObjectLike } from "@repo/type-guards"


/**
 * Global NestJS exception filter.
 *
 * Resolution order, by exception type:
 *   1. `MeshBaseDomainError` (mesh domain errors)
 *      → 4xx with the error's own `httpStatus`, and the wire body
 *        `{ statusCode, code, message, orpcCode, requestId }`. Never
 *        leaks the stack. Logged at warn level (not error) because
 *        these are expected user-visible outcomes, not bugs.
 *   2. `HttpException` (NestJS framework errors, e.g. NotFoundException)
 *      → its own status, with `requestId` attached.
 *   3. Anything else → 500 "Internal server error" with a traceId,
 *      captured by the insight service.
 *
 * The single point of contact is `resolveStatusAndBody` so the three
 * branches stay easy to compare and audit.
 */
@Injectable()
@Catch()
export class InternalErrorExceptionFilter implements ExceptionFilter {
    constructor(private readonly internalErrorInsightService: InternalErrorInsightService) {}

    catch(exception: unknown, host: ArgumentsHost): void {
        const httpContext = host.switchToHttp();
        const response = httpContext.getResponse<Response>();
        const request = httpContext.getRequest<Request>();
        const requestContext = getInternalErrorRequestContext(request);

        // ── 1. Mesh domain error ───────────────────────────────────────────
        if (MeshBaseDomainError.isMeshDomainError(exception)) {
            const body = exception.toJSON();
            // 4xx → expected outcome (warn), 5xx → bug (error)
            if (body.httpStatus >= 500) {
                const { traceId, requestId } = this.internalErrorInsightService.capture(exception, {
                    source: "mesh-domain",
                    request,
                });
                response.status(body.httpStatus).json({
                    statusCode: body.httpStatus,
                    code: body.code,
                    message: body.message,
                    orpcCode: body.orpcCode,
                    requestId,
                    traceId,
                });
            } else {
                response.status(body.httpStatus).json({
                    statusCode: body.httpStatus,
                    code: body.code,
                    message: body.message,
                    orpcCode: body.orpcCode,
                    requestId: requestContext?.requestId,
                });
            }
            return;
        }

        // ── 2. NestJS HttpException (4xx framework errors) ─────────────────
        if (exception instanceof HttpException) {
            const status = exception.getStatus();
            if (status < 500) {
                const exceptionResponse = exception.getResponse();
                const responsePayload =
                    typeof exceptionResponse === "string"
                        ? {
                            statusCode: status,
                            message: exceptionResponse,
                        }
                        : {
                            statusCode: status,
                            ...(isRecord(exceptionResponse) ? exceptionResponse : {}),
                        };

                response.status(status).json({
                    ...responsePayload,
                    requestId: requestContext?.requestId,
                });
                return;
            }
        }

        // ── 3. Anything else (unhandled) → 500 ─────────────────────────────
        const status = exception instanceof HttpException ? exception.getStatus() : 500;
        const { traceId, requestId } = this.internalErrorInsightService.capture(exception, {
            source: "nest-http",
            request,
        });

        response.status(status).json({
            statusCode: status,
            message: "Internal server error",
            requestId,
            traceId,
            ...(this.internalErrorInsightService.shouldExposeDebugPayload()
                ? {
                    debug: this.internalErrorInsightService.buildClientDebugPayload(exception),
                }
                : {}),
        });
    }
}
