import { Effect } from "effect";

import { fromAbortable, runPromiseUnwrapped } from "@deployer/effect-core";

import { ServiceUnreachable } from "../errors";

import { normalizeErrorResponse } from "./normalize-error-response";

export type ServiceFetchOptions = {
	readonly service: string;
	readonly origin: string;
	/** Headers for this request, read at call time: they carry the caller's credentials. */
	readonly headers: () => Record<string, string>;
};

/**
 * One outgoing call to a service, as an Effect: the headers are read now (not when the client was
 * built), interrupting the fiber aborts the request, and a connection that fails before any response
 * is a `ServiceUnreachable` naming the service and where it was expected. A non-oRPC error answer
 * (a guard's plain-text 401) is rewritten into the oRPC error shape.
 */
export const callService = (
	options: ServiceFetchOptions,
	request: RequestInfo | URL,
	init?: RequestInit,
): Effect.Effect<Response, ServiceUnreachable> =>
	Effect.suspend(() => {
		const extra = options.headers();
		return fromAbortable(
			(signal) =>
				fetch(request, {
					...init,
					headers: { ...(init?.headers as Record<string, string> | undefined), ...extra },
					signal,
				}),
			(cause) =>
				new ServiceUnreachable({
					service: options.service,
					origin: options.origin,
					reason: cause instanceof Error ? cause.message : String(cause),
				}),
		);
	}).pipe(Effect.flatMap((response) => Effect.promise(() => normalizeErrorResponse(response))));

/**
 * `callService` as the `fetch` oRPC's link expects. The caller's own abort signal interrupts the
 * Effect, which aborts the request.
 */
export const makeServiceFetch =
	(options: ServiceFetchOptions) =>
	(request: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
		runPromiseUnwrapped(
			callService(options, request, init),
			{ signal: init?.signal ?? undefined },
		);
