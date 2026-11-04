import { hostname } from "node:os";

import { logger } from "@deployer/logger";

import { edgeUse, type HttpEdgeEntry } from "../../server/http-edge";

import type { RequestHandler } from "express";

/** URL prefixes that are never logged: probes and noise would drown the real traffic. */
const SKIPPED_PREFIXES = ["/health", "/metrics", "/favicon.ico"] as const;

const log = logger.scope("http");

const colour = (code: number, text: string): string => `\x1b[${String(code)}m${text}\x1b[0m`;

/** Status colour: red 5xx, purple 4xx, yellow 3xx, green otherwise. */
function statusColour(status: number): string {
	if (status >= 500) return colour(31, String(status));
	if (status >= 400) return colour(35, String(status));
	if (status >= 300) return colour(33, String(status));
	return colour(32, String(status));
}

/**
 * One access-log line per finished request, written when the response CLOSES.
 *
 * 5xx is an error, 4xx a warning (validation/auth/not-found are actionable and should be visible without enabling debug),
 * everything else debug. Do NOT call `res.end()` from here: it interrupts streaming responses and causes HTTP/2 protocol
 * errors (`ERR_HTTP2_PROTOCOL_ERROR`).
 *
 * A plain function, not a Nest middleware: see `server/http-edge.ts`.
 */
export function accessLog(): RequestHandler {
	return (req, res, next) => {
		const { ip, method, originalUrl: url } = req;
		const userAgent = req.get("user-agent") ?? "";
		const referer = req.get("referer") ?? "";

		res.on("close", () => {
			if (SKIPPED_PREFIXES.some((prefix) => url.startsWith(prefix))) return;

			const { statusCode, statusMessage } = res;
			const line = `[${hostname()}] "${method} ${colour(32, url)}" ${statusColour(statusCode)} ${statusMessage} ${String(res.get("content-length"))} "${referer}" "${userAgent}" "${String(ip)}"`;

			if (statusCode >= 500) log.error(line);
			else if (statusCode >= 400) log.warn(line);
			else log.debug(line);
		});
		next();
	};
}

export const accessLogEdge = (): HttpEdgeEntry => edgeUse("access-log", accessLog());
