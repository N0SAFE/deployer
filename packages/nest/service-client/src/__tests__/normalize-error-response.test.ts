import { describe, expect, it } from "vitest";

import { normalizeErrorResponse } from "../normalize-error-response";

describe("normalizeErrorResponse", () => {
	it("passes a success through untouched", async () => {
		const ok = new Response("{}", { status: 200 });

		expect(await normalizeErrorResponse(ok)).toBe(ok);
	});

	it("keeps a real oRPC error's code and data", async () => {
		const body = { defined: true, code: "FORBIDDEN", message: "no", data: { why: "role" } };
		const error = new Response(JSON.stringify(body), { status: 403, headers: { "content-type": "application/json" } });

		const normalized = await normalizeErrorResponse(error);

		expect(normalized.status).toBe(403);
		expect(await normalized.json()).toEqual(body);
	});

	it("rewrites a JSON body that is only a string, which is what a service's 401 guard sent", async () => {
		const bare = new Response('"Unauthorized"', { status: 401, headers: { "content-type": "application/json" } });

		const normalized = await normalizeErrorResponse(bare);

		expect(await normalized.json()).toEqual({ code: "UNAUTHORIZED", message: "Unauthorized", defined: false });
	});

	it("rewrites a Nest-style JSON error that is not an oRPC error", async () => {
		const nest = new Response('{"statusCode":401,"message":"Unauthorized"}', { status: 401, headers: { "content-type": "application/json" } });

		expect(await (await normalizeErrorResponse(nest)).json()).toEqual({ code: "UNAUTHORIZED", message: "Unauthorized", defined: false });
	});

	it("rewrites a plain-text 401 into the oRPC error shape, keeping the status", async () => {
		const plain = new Response("Unauthorized", { status: 401, headers: { "content-type": "text/plain" } });

		const normalized = await normalizeErrorResponse(plain);

		expect(normalized.status).toBe(401);
		expect(normalized.headers.get("content-type")).toBe("application/json");
		expect(await normalized.json()).toEqual({ code: "UNAUTHORIZED", message: "Unauthorized", defined: false });
	});

	it("maps other statuses and falls back to an internal error", async () => {
		const notFound = await normalizeErrorResponse(new Response("nope", { status: 404 }));
		const odd = await normalizeErrorResponse(new Response("", { status: 418, statusText: "I'm a teapot" }));

		expect(await notFound.json()).toMatchObject({ code: "NOT_FOUND" });
		expect(await odd.json()).toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "I'm a teapot" });
	});

	it("does not echo a huge body as the message", async () => {
		const normalized = await normalizeErrorResponse(new Response("x".repeat(2000), { status: 500, statusText: "Internal Server Error" }));

		expect(((await normalized.json()) as { message: string }).message).toBe("Internal Server Error");
	});
});
