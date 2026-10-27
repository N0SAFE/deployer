import { ORPCError } from "@orpc/client";
import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { afterEach, describe, expect, it } from "vitest";
import z from "zod/v4";

import { ServiceClientRegistry } from "../service-client.registry";

/**
 * What a service's answer looks like once it has crossed the wire to the BFF.
 *
 * Both cases here were live failures on the compose stack: a response carrying a date made the
 * BFF answer `500 Output validation failed` (the date arrived as a string), and a guard's
 * plain-text `401` made it answer `500` too (the body was not an oRPC error).
 */
const contract = oc.meta(openapi({ tags: ["t"], prefix: "/t" })).router({
	getThing: oc
		.meta(openapi({ method: "GET", path: "/thing" }))
		.output(z.object({ id: z.string(), label: z.string(), createdAt: z.date() })),
});

type Client = { getThing: (input: unknown) => Promise<{ id: string; label: string; createdAt: unknown }> };

const original = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = original;
});

function clientAnswering(response: () => Response): Client {
	globalThis.fetch = (() => Promise.resolve(response())) as unknown as typeof fetch;
	const registry = new ServiceClientRegistry({ resolveOrigin: () => "http://svc.test", headers: () => ({}) });
	return registry.bind("svc", contract) as unknown as Client;
}

describe("delegation transport", () => {
	it("hands the handler a Date where the contract declares one, and leaves a string field alone", async () => {
		const iso = "2026-10-27T10:00:00.000Z";
		const client = clientAnswering(
			() => new Response(JSON.stringify({ id: "1", label: iso, createdAt: iso }), { headers: { "content-type": "application/json" } }),
		);

		const result = await client.getThing({});

		expect(result.createdAt).toEqual(new Date(iso));
		expect(result.label).toBe(iso);
	});

	it("surfaces a plain-text 401 as an UNAUTHORIZED oRPC error, not a malformed response", async () => {
		const client = clientAnswering(() => new Response("Unauthorized", { status: 401, headers: { "content-type": "text/plain" } }));

		const error = (await client.getThing({}).catch((e: unknown) => e)) as { code: string; message: string };

		// The HTTP status is derived from the code when the BFF rethrows it (UNAUTHORIZED is 401).
		expect(error).toBeInstanceOf(ORPCError);
		expect([error.code, error.message]).toEqual(["UNAUTHORIZED", "Unauthorized"]);
	});

	it("keeps a real oRPC error's code and data", async () => {
		const client = clientAnswering(
			() =>
				new Response(JSON.stringify({ defined: true, code: "FORBIDDEN", message: "no", data: { why: "role" } }), {
					status: 403,
					headers: { "content-type": "application/json" },
				}),
		);

		const error = (await client.getThing({}).catch((e: unknown) => e)) as { code: string; data: unknown };

		expect([error.code, error.data]).toEqual(["FORBIDDEN", { why: "role" }]);
	});
});
