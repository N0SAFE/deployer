import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getSharedApiRuntimeContext, stopSharedApiRuntime, type SharedApiRuntimeContext } from "@/e2e/runtime";
import { createAuthenticatedSession } from "@deployer/shared/e2e-harness/authenticated-session";

/**
 * The BFF delegating to a service, over the real wire format.
 *
 * The BFF does not implement `/user`: it calls the identity service through a typed client and
 * returns the answer from a handler bound to the SAME contract, so oRPC validates it again. Two
 * things broke on the first full boot and no test noticed, because every earlier BFF spec stopped
 * at "anonymous gets 401":
 *
 *  1. A service answers JSON, so a date arrives as an ISO string while the contract says `Date`:
 *     every delegated route carrying a date answered `500 Output validation failed`.
 *  2. A guard in front of a service answered a plain-text `401`, which the client could not decode:
 *     the BFF turned a missing session into a `500`.
 *
 * The upstream here is a stub that speaks exactly that wire format, so the BFF's own client,
 * interceptors and validation are the real ones.
 */
const ISO = "2026-10-27T10:00:00.000Z";

const user = {
	id: "u-1",
	name: "Ada",
	email: "ada@example.test",
	emailVerified: true,
	image: null,
	createdAt: ISO,
	updatedAt: ISO,
	role: "admin",
};

describe("BFF delegated routes e2e: the service's wire format reaches the caller intact", () => {
	const INSTANCE = "delegation-upstream";
	let upstream: Server;
	let context: SharedApiRuntimeContext;
	let previousUrls: string | undefined;
	const seen: { path: string; cookie: string | undefined }[] = [];
	// Two REAL sessions on the BFF (it refuses callers without one before delegating). The stub
	// stands in for a service that honours the first and refuses the second.
	let accepted = "";
	let refused = "";
	let refusedAsJson = "";

	const handle = (request: IncomingMessage, response: ServerResponse) => {
		const path = (request.url ?? "").split("?")[0] ?? "";
		seen.push({ path, cookie: request.headers.cookie });

		if (request.headers.cookie === refusedAsJson) {
			// A guard that answers 401 with a JSON body that is only a string.
			response.writeHead(401, { "content-type": "application/json" }).end('"Unauthorized"');
			return;
		}
		if (request.headers.cookie !== accepted) {
			// What a Nest guard in front of the router answers: plain text, not an oRPC error.
			response.writeHead(401, { "content-type": "text/plain" }).end("Unauthorized");
			return;
		}
		if (path === "/user" || path === "/user/") {
			response
				.writeHead(200, { "content-type": "application/json" })
				.end(JSON.stringify({ data: [user], meta: { total: 1, limit: 20, offset: 0, hasMore: false } }));
			return;
		}
		response.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ defined: false, code: "NOT_FOUND", message: "no route" }));
	};

	beforeAll(async () => {
		upstream = createServer(handle);
		await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
		const { port } = upstream.address() as AddressInfo;

		// Set BEFORE the BFF boots: the registry resolves and caches a service's origin on first use.
		previousUrls = process.env.API_SERVICE_URLS;
		process.env.API_SERVICE_URLS = JSON.stringify({ identity: `http://127.0.0.1:${String(port)}` });
		context = await getSharedApiRuntimeContext({ instanceKey: INSTANCE });
		accepted = (await createAuthenticatedSession(context, { role: "admin" })).cookie;
		refused = (await createAuthenticatedSession(context, { role: "admin" })).cookie;
		refusedAsJson = (await createAuthenticatedSession(context, { role: "admin" })).cookie;
	}, 180_000);

	afterAll(async () => {
		await stopSharedApiRuntime({ instanceKey: INSTANCE });
		if (previousUrls === undefined) delete process.env.API_SERVICE_URLS;
		else process.env.API_SERVICE_URLS = previousUrls;
		await new Promise<void>((resolve) => upstream.close(() => { resolve(); }));
	});

	it("returns a delegated list whose dates arrived as ISO strings, instead of a 500", async () => {
		const response = await context.http.get("/user").set("cookie", accepted).expect(200);

		const body = response.body as { data: { id: string; createdAt: string }[]; meta: { limit: number } };
		expect(body.data[0]?.id).toBe("u-1");
		// Back on the wire as an ISO string: it was revived to a Date for validation, then serialised again.
		expect(body.data[0]?.createdAt).toBe(ISO);
		expect(body.meta.limit).toBe(20);
	});

	it("forwards the caller's credentials to the service", async () => {
		await context.http.get("/user").set("cookie", accepted).expect(200);

		expect(seen.at(-1)?.cookie).toBe(accepted);
	});

	it("surfaces a service's plain-text 401 as a 401, not a 500", async () => {
		const response = await context.http.get("/user").set("cookie", refused).expect(401);

		expect((response.body as { code: string }).code).toBe("UNAUTHORIZED");
	});

	it("surfaces a 401 whose JSON body is only the string \"Unauthorized\" as a 401 too", async () => {
		const response = await context.http.get("/user").set("cookie", refusedAsJson).expect(401);

		expect((response.body as { code: string }).code).toBe("UNAUTHORIZED");
	});
});
