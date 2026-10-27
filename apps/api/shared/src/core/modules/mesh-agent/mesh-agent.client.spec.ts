import { afterEach, describe, expect, it, vi } from "vitest";

import type { EnvService } from "../../../config/env/env.module";
import { MeshAgentClient, MeshAgentRequestError, MeshAgentUnavailableError } from "./mesh-agent.client";

const env = { get: vi.fn(() => "/run/deployer-mesh/agent.sock") } as unknown as EnvService;

function respond(status: number, body: unknown) {
	return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

describe("MeshAgentClient", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("dials the agent's unix socket", async () => {
		const fetchSpy = respond(200, { "ingress.lanes": { entryPort: 80 } });
		expect(await new MeshAgentClient(env).readSettings()).toEqual({ "ingress.lanes": { entryPort: 80 } });
		expect(fetchSpy).toHaveBeenCalledWith("http://mesh-agent/v1/settings", expect.objectContaining({ method: "GET", unix: "/run/deployer-mesh/agent.sock" }));
	});

	it("reports a missing agent as its own typed condition", async () => {
		vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ENOENT"));
		await expect(new MeshAgentClient(env).status()).rejects.toBeInstanceOf(MeshAgentUnavailableError);
	});

	it("surfaces the agent's own refusal code", async () => {
		respond(409, { code: "not-in-cluster", message: "this agent has not founded or joined a cluster" });
		const error = await new MeshAgentClient(env).writeSetting("k", 1).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(MeshAgentRequestError);
		expect(error).toMatchObject({ agentCode: "not-in-cluster", status: 409 });
	});

	it("rejects a response that does not match the protocol", async () => {
		respond(200, { not: "a status" });
		await expect(new MeshAgentClient(env).status()).rejects.toThrow();
	});
});
