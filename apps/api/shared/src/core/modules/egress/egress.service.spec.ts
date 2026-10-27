import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EgressRequestError, EgressService } from "./egress.service";

let server: Bun.Server<undefined>;
let base: string;
const hits: string[] = [];

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch: (req) => {
			const path = new URL(req.url).pathname;
			hits.push(path);
			if (path === "/mesh/ping") return Response.json({ ok: true, version: "1.0.0", advertisedHost: "peer.lan" });
			if (path === "/slow") return new Promise<Response>(() => undefined);
			if (path === "/bad") return new Response("<html>", { status: 500 });
			return new Response("ok");
		},
	});
	base = `http://127.0.0.1:${String(server.port)}`;
});

afterAll(async () => {
	await server.stop(true);
});

const prod = () => new EgressService({ NODE_ENV: "production" });
const dev = () => new EgressService({ NODE_ENV: "development" });

const rejection = async (promise: Promise<unknown>): Promise<EgressRequestError> => {
	const error = await promise.then(
		() => undefined,
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(EgressRequestError);
	return error as EgressRequestError;
};

describe("EgressService", () => {
	it("production refuses a loopback target with a generic message and makes no request", async () => {
		const before = hits.length;
		for (const call of [() => prod().external({ url: `${base}/ok` }), () => prod().operator({ url: `${base}/ok` })]) {
			const error = await rejection(call());
			expect(error.message).toBe("Target not allowed by the network policy");
			expect(error.message).not.toContain("127.0.0.1");
		}
		expect(hits.length).toBe(before);
	});

	it("refuses cloud metadata in every environment", async () => {
		for (const service of [prod(), dev()]) {
			expect((await rejection(service.external({ url: "http://169.254.169.254/latest/meta-data/" }))).message).toBe(
				"Target not allowed by the network policy",
			);
			expect((await rejection(service.operator({ url: "http://169.254.169.254/" }))).message).toBe("Target not allowed by the network policy");
		}
	});

	it("outside production a local target is reachable", async () => {
		const res = await dev().operator({ url: `${base}/ok` });
		expect(res.status).toBe(200);
	});

	it("keeps the real reason (kind and cause) for the logs but not in the message", async () => {
		const error = await rejection(prod().operator({ url: `${base}/ok` }));
		expect(error.kind).toBe("operator");
		expect((error.cause as { _tag?: string })._tag).toBe("EgressDenied");
	});

	it("classifies the failure so callers can map it to a status", async () => {
		expect((await rejection(prod().operator({ url: `${base}/ok` }))).failure).toBe("denied");
		expect((await rejection(dev().operator({ url: `${base}/slow` }, { timeoutMs: 150 }))).failure).toBe("timeout");
		expect((await rejection(dev().operator({ url: "http://127.0.0.1:1/" }))).failure).toBe("failed");
	});

	it("a refused connection is reported as a category, not as the raw transport error", async () => {
		const error = await rejection(dev().operator({ url: "http://127.0.0.1:1/" }));
		expect(error.message).toBe("Connection failed");
		expect(error.message).not.toMatch(/ECONNREFUSED|127\.0\.0\.1/);
	});

	it("fixedExternal only reaches its allow-listed hosts", async () => {
		const error = await rejection(dev().fixedExternal({ url: `${base}/ok` }, ["dns.google"]));
		expect(error.message).toBe("Target not allowed by the network policy");
		expect(error.kind).toBe("fixedExternal");
	});
});

describe("EgressService.probeHttp (the function handed to probeAddress / probePeer)", () => {
	it("adapts a response to ok / status / json", async () => {
		const res = await dev().probeHttp("operator")(`${base}/mesh/ping`, { timeoutMs: 2000 });
		expect(res.ok).toBe(true);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, version: "1.0.0", advertisedHost: "peer.lan" });
	});

	it("reports a non-2xx as not ok without throwing", async () => {
		const res = await dev().probeHttp("external")(`${base}/bad`, { timeoutMs: 2000 });
		expect(res.ok).toBe(false);
		expect(res.status).toBe(500);
	});

	it("honours the caller's timeout", async () => {
		const error = await rejection(dev().probeHttp("operator")(`${base}/slow`, { timeoutMs: 200 }));
		expect(error.message).toBe("Timed out");
	});

	it("applies the same policy as the direct methods", async () => {
		const error = await rejection(prod().probeHttp("external")(`${base}/ok`, { timeoutMs: 1000 }));
		expect(error.message).toBe("Target not allowed by the network policy");
	});
});
