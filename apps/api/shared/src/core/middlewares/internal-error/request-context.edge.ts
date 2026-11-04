import { randomUUID } from "node:crypto";

import { edgeUse, type HttpEdgeEntry } from "../../../server/http-edge";

import { setInternalErrorRequestContext, type InternalErrorRequestContext } from "./internal-error-context";

import type { RequestHandler } from "express";

/**
 * Gives every request an id (the caller's `x-request-id` when it sent one) and records what an error report needs to say
 * where it came from; the id is echoed on the response so a client can quote it.
 *
 * A plain function, not a Nest middleware: see `server/http-edge.ts`.
 */
export function requestContext(): RequestHandler {
	return (req, res, next) => {
		const incoming = req.get("x-request-id")?.trim();
		const requestId = incoming !== undefined && incoming.length > 0 ? incoming : randomUUID();

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
	};
}

export const requestContextEdge = (): HttpEdgeEntry => edgeUse("request-context", requestContext());
