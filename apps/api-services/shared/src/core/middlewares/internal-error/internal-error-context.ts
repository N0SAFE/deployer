import type { IncomingMessage } from "node:http";

export const INTERNAL_ERROR_CONTEXT_KEY = Symbol.for("api.internal-error-context");

export interface InternalErrorRequestContext {
    requestId: string;
    method: string;
    path: string;
    ip?: string;
    userAgent?: string;
}

type RequestWithInternalErrorContext = IncomingMessage & {
    [INTERNAL_ERROR_CONTEXT_KEY]?: InternalErrorRequestContext;
};

export function setInternalErrorRequestContext(req: IncomingMessage, context: InternalErrorRequestContext): void {
    (req as RequestWithInternalErrorContext)[INTERNAL_ERROR_CONTEXT_KEY] = context;
}

export function getInternalErrorRequestContext(req: IncomingMessage): InternalErrorRequestContext | undefined {
    return (req as RequestWithInternalErrorContext)[INTERNAL_ERROR_CONTEXT_KEY];
}
