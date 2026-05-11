import type { ArgumentsHost } from "@nestjs/common";
import { Catch, Injectable } from "@nestjs/common";
import type { ExceptionFilter } from "@nestjs/common";
import { APIError } from "better-auth/api";
import type { Request, Response } from "express";
import { getInternalErrorRequestContext } from "@/core/middlewares/internal-error/internal-error-context";
import { InternalErrorInsightService } from "@/core/middlewares/internal-error/internal-error-insight.service";

@Injectable()
@Catch(APIError)
export class APIErrorExceptionFilter implements ExceptionFilter {
	constructor(private readonly internalErrorInsightService: InternalErrorInsightService) {}

	catch(exception: APIError, host: ArgumentsHost): void {
		const ctx = host.switchToHttp();
		const request = ctx.getRequest<Request>();
		const response = ctx.getResponse<Response>();
		const requestContext = getInternalErrorRequestContext(request);
		const status = exception.statusCode;
		const message = exception.body?.message;
		const traceId = status >= 500
			? this.internalErrorInsightService.capture(exception, {
				source: "better-auth",
				request,
			}).traceId
			: undefined;

		response.status(status).json({
			statusCode: status,
			message,
			requestId: requestContext?.requestId,
			traceId,
			...(status >= 500 && this.internalErrorInsightService.shouldExposeDebugPayload()
				? {
					debug: this.internalErrorInsightService.buildClientDebugPayload(exception),
				}
				: {}),
		});
	}
}
