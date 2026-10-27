/**
 * Make a service's NON-oRPC error answer readable as an oRPC error.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * A service can answer an error that no oRPC procedure produced: a Nest guard or filter in
 * front of the router replying `401` with the plain text `Unauthorized`. The client's decoder
 * expects an oRPC JSON body, throws `MalformedResponseError`, and the BFF turned that into a
 * `500` for the caller, so a missing session read as a server fault. Rewriting such a response
 * into the oRPC error shape lets it surface with its real status (`401` stays `401`).
 *
 * Responses that are already JSON are left alone: a real oRPC error carries its own code and
 * data, and rewriting it would lose them.
 */

const CODE_BY_STATUS: Readonly<Record<number, string>> = {
	400: "BAD_REQUEST",
	401: "UNAUTHORIZED",
	403: "FORBIDDEN",
	404: "NOT_FOUND",
	405: "METHOD_NOT_SUPPORTED",
	409: "CONFLICT",
	422: "UNPROCESSABLE_CONTENT",
	429: "TOO_MANY_REQUESTS",
	502: "BAD_GATEWAY",
	503: "SERVICE_UNAVAILABLE",
	504: "GATEWAY_TIMEOUT",
};

/** The shape oRPC's own decoder accepts as an error: `isORPCErrorJson` rejects any other key. */
function isOrpcErrorBody(value: unknown): boolean {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const body = value as Record<string, unknown>;
	const allowed = new Set(["defined", "code", "message", "data"]);
	return (
		Object.keys(body).every((key) => allowed.has(key)) &&
		typeof body.defined === "boolean" &&
		typeof body.code === "string" &&
		typeof body.message === "string"
	);
}

export async function normalizeErrorResponse(response: Response): Promise<Response> {
	if (response.ok) return response;

	const text = (await response.text()).trim();
	let parsed: unknown;
	try {
		parsed = text.length > 0 ? JSON.parse(text) : undefined;
	} catch {
		parsed = undefined;
	}
	// A real oRPC error keeps its own code and data. Judged by its BODY, not its content type: a
	// service can answer `application/json` with the bare string `"Unauthorized"`.
	if (isOrpcErrorBody(parsed)) {
		return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
	}

	const detail =
		typeof parsed === "string"
			? parsed
			: typeof (parsed as { message?: unknown } | undefined)?.message === "string"
				? (parsed as { message: string }).message
				: text;
	const body = {
		defined: false,
		code: CODE_BY_STATUS[response.status] ?? "INTERNAL_SERVER_ERROR",
		message: detail.length > 0 && detail.length < 500 ? detail : response.statusText || "Request failed",
	};
	return new Response(JSON.stringify(body), {
		status: response.status,
		statusText: response.statusText,
		headers: { "content-type": "application/json" },
	});
}
