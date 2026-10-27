import { Injectable, type NestMiddleware } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import {
    setInternalErrorRequestContext,
    type InternalErrorRequestContext,
} from "./internal-error-context";

@Injectable()
export class InternalErrorContextMiddleware implements NestMiddleware {
    use(req: Request, res: Response, next: () => void): void {
        const incomingRequestId = req.get("x-request-id") ?? undefined;
        const requestId = incomingRequestId && incomingRequestId.trim().length > 0 ? incomingRequestId : randomUUID();

        const context: InternalErrorRequestContext = {
            requestId,
            method: req.method,
            path: req.originalUrl,
            ip: req.ip,
            userAgent: req.get("user-agent") ?? undefined,
        };

        setInternalErrorRequestContext(req, context);
        res.setHeader("x-request-id", requestId);

        next();
    }
}
