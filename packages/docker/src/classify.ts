/** Message of anything an engine call may throw, preferring the engine's own JSON message. */
export function engineMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "object" && error !== null) {
		if ("json" in error && typeof error.json === "object" && error.json !== null && "message" in error.json) {
			const message = error.json.message;
			if (typeof message === "string") return message;
		}
		if ("message" in error && typeof error.message === "string") return error.message;
	}
	return String(error);
}

/** The engine answered 404. */
export function isNotFound(error: unknown): boolean {
	return typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 404;
}
