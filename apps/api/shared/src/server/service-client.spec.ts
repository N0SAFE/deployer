import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";

const contract = {
	ping: oc.meta(openapi({ method: "GET", path: "/ping" })).output(z.object({ ok: z.boolean() })),
};

type PingClient = { ping: () => Promise<unknown> };

/** The module reads where the agent's socket is when it loads, so each case loads a fresh copy under its own environment. */
async function load(socket: string | undefined) {
	vi.resetModules();
	if (socket === undefined) delete process.env.MESH_AGENT_SOCKET;
	else process.env.MESH_AGENT_SOCKET = socket;
	return (await import("./service-client")).ServiceClient;
}

describe("ServiceClient", () => {
	let directory: string;
	const fetchSpy = vi.fn();

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "service-client-"));
		fetchSpy.mockReset().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } }));
		vi.stubGlobal("fetch", fetchSpy);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		delete process.env.MESH_AGENT_SOCKET;
		rmSync(directory, { recursive: true, force: true });
	});

	it("calls the service's own HTTP surface when the node has no agent, as a node does alone", async () => {
		const ServiceClient = await load(join(directory, "no-such-agent.sock"));

		const client = new ServiceClient().clientFor("project", contract as never) as unknown as PingClient;
		await client.ping();

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const target = (fetchSpy.mock.calls[0] as [Request | URL | string])[0];
		expect(typeof target === "object" && "url" in target ? target.url : String(target)).toContain("/ping");
	});

	it("sends the call to the agent and never to the service's HTTP surface when the node has one", async () => {
		const socket = join(directory, "agent.sock");
		writeFileSync(socket, "");
		const ServiceClient = await load(socket);

		const client = new ServiceClient().clientFor("project", contract as never) as unknown as PingClient;
		// Nothing listens on the socket, so the call fails; what matters is where it tried to go.
		await expect(client.ping()).rejects.toBeDefined();

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("gives one client per service and contract", async () => {
		const ServiceClient = await load(undefined);
		const clients = new ServiceClient();

		expect(clients.clientFor("project", contract as never)).toBe(clients.clientFor("project", contract as never));
		expect(clients.clientFor("project", contract as never)).not.toBe(clients.clientFor("fleet", contract as never));
	});

	it("builds a fresh client for each system-actor call, since the claim is short-lived", async () => {
		const ServiceClient = await load(undefined);
		const clients = new ServiceClient();

		expect(clients.systemActorClientFor("project", contract as never, "claim-1")).not.toBe(clients.systemActorClientFor("project", contract as never, "claim-2"));
	});
});
