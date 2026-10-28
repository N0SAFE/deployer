import { Cause, Effect, Exit } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServiceUnreachable } from "../errors";

import { callService, makeServiceFetch } from "./service-fetch";

const options = (headers: () => Record<string, string> = () => ({})) => ({
	service: "identity",
	origin: "http://identity:3001",
	headers,
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("callService", () => {
	it("reads the headers at call time and merges them over the request's own", async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { headers: { "content-type": "application/json" } }));
		vi.stubGlobal("fetch", fetchMock);
		let session = "alice";
		const call = () => Effect.runPromise(callService(options(() => ({ authorization: session })), "http://x/y", { headers: { accept: "json" } }));

		await call();
		session = "bob";
		await call();

		expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ accept: "json", authorization: "alice" });
		expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual({ accept: "json", authorization: "bob" });
	});

	it("fails with ServiceUnreachable naming the service when the connection fails", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
		const exit = await Effect.runPromiseExit(callService(options(), "http://x/y"));
		const failure = Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
		expect(failure).toBeInstanceOf(ServiceUnreachable);
		expect((failure as ServiceUnreachable).publicMessage()).toBe(
			"Service 'identity' (http://identity:3001) is unreachable: fetch failed",
		);
	});

	it("rewrites a plain-text error answer into the oRPC error shape", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 })));
		const response = await Effect.runPromise(callService(options(), "http://x/y"));
		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
	});
});

describe("makeServiceFetch", () => {
	it("rejects with the original ServiceUnreachable, not a wrapper", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
		await expect(makeServiceFetch(options())("http://x/y")).rejects.toBeInstanceOf(ServiceUnreachable);
	});

	it("aborts the request when the caller's signal aborts", async () => {
		let seen: AbortSignal | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn((_request: unknown, init?: RequestInit) => {
				seen = init?.signal ?? undefined;
				return new Promise(() => undefined);
			}),
		);
		const controller = new AbortController();
		const pending = makeServiceFetch(options())("http://x/y", { signal: controller.signal });
		await Promise.resolve();
		controller.abort();
		await expect(pending).rejects.toBeDefined();
		expect(seen?.aborted).toBe(true);
	});
});
