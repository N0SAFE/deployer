import type { Request } from "express";

export const INTERNAL_ERROR_CONTEXT_KEY = Symbol.for("api.internal-error-context");

export interface InternalErrorRequestContext {
    requestId: string;
    method: string;
    path: string;
    ip?: string;
    userAgent?: string;
}

type RequestWithInternalErrorContext = Request & {
    [INTERNAL_ERROR_CONTEXT_KEY]?: InternalErrorRequestContext;
};

export function setInternalErrorRequestContext(req: Request, context: InternalErrorRequestContext): void {
    (req as RequestWithInternalErrorContext)[INTERNAL_ERROR_CONTEXT_KEY] = context;
}

export function getInternalErrorRequestContext(req: Request): InternalErrorRequestContext | undefined {
    return (req as RequestWithInternalErrorContext)[INTERNAL_ERROR_CONTEXT_KEY];
}
