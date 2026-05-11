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

@Injectable()
@Catch()
export class InternalErrorExceptionFilter implements ExceptionFilter {
    constructor(private readonly internalErrorInsightService: InternalErrorInsightService) {}

    catch(exception: unknown, host: ArgumentsHost): void {
        const httpContext = host.switchToHttp();
        const response = httpContext.getResponse<Response>();
        const request = httpContext.getRequest<Request>();
        const requestContext = getInternalErrorRequestContext(request);

        const status = exception instanceof HttpException ? exception.getStatus() : 500;

        if (status < 500 && exception instanceof HttpException) {
            const exceptionResponse = exception.getResponse();
            const responsePayload =
                typeof exceptionResponse === "string"
                    ? {
                        statusCode: status,
                        message: exceptionResponse,
                    }
                    : {
                        statusCode: status,
                        ...(exceptionResponse as Record<string, unknown>),
                    };

            response.status(status).json({
                ...responsePayload,
                requestId: requestContext?.requestId,
            });
            return;
        }

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
