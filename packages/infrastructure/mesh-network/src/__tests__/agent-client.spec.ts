import { describe, expect, it, vi } from "vitest";

import { MeshAgentHttpClient, MeshAgentRefusedError, MeshAgentUnreachableError, type UnixFetch } from "../agent-client";
import { AGENT_CONTAINER_NAME, ensureMeshAgentContainer, meshAgentContainerEnv, meshAgentContainerSpec, type MeshAgentEngine } from "../agent-container";

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("MeshAgentHttpClient", () => {
	it("dials the socket and validates the reply", async () => {
		const fetchImpl = vi.fn<UnixFetch>(() => json(200, { a: 1 }));
		expect(await new MeshAgentHttpClient("/run/x.sock", fetchImpl).readSettings()).toEqual({ a: 1 });
		expect(fetchImpl).toHaveBeenCalledWith("http://mesh-agent/v1/settings", expect.objectContaining({ method: "GET", unix: "/run/x.sock" }));
	});

	it("separates an absent agent from a refusing one", async () => {
		await expect(new MeshAgentHttpClient("/x", () => Promise.reject(new Error("ENOENT"))).status()).rejects.toBeInstanceOf(MeshAgentUnreachableError);
		const refused = await new MeshAgentHttpClient("/x", () => json(409, { code: "not-in-cluster", message: "no" })).readSettings().catch((e: unknown) => e);
		expect(refused).toBeInstanceOf(MeshAgentRefusedError);
		expect(refused).toMatchObject({ code: "not-in-cluster", status: 409 });
	});

	it("waits for an agent that is still starting", async () => {
		const status = { memberId: "m", signingKey: "k", wireguardKey: "w", cluster: null, members: [], settingKeys: [], doors: [], lastGossipAt: null, lastError: null };
		const fetchImpl = vi.fn<UnixFetch>().mockRejectedValueOnce(new Error("ENOENT")).mockImplementation(() => json(200, status));
		expect(await new MeshAgentHttpClient("/x", fetchImpl).waitUntilReachable(1_000, 1)).toEqual(status);
	});
});

class Engine implements MeshAgentEngine {
	container: { id: string; running: boolean; image: string; managed: boolean; env: readonly string[] } | null = null;
	calls: string[] = [];
	inspect() {
		return Promise.resolve(this.container);
	}
	create(_name: string, spec: Record<string, unknown>) {
		this.calls.push("create");
		this.container = { id: "new", running: false, image: spec.Image as string, managed: true, env: (spec.Env as string[]) ?? [] };
		return Promise.resolve("new");
	}
	start() {
		this.calls.push("start");
		if (this.container) this.container.running = true;
		return Promise.resolve();
	}
	remove() {
		this.calls.push("remove");
		return Promise.resolve();
	}
	imageExists() {
		return Promise.resolve(true);
	}
	pull() {
		this.calls.push("pull");
		return Promise.resolve();
	}
}

describe("ensureMeshAgentContainer", () => {
	it("creates the agent in the HOST network namespace with NET_ADMIN", async () => {
		const engine = new Engine();
		expect(await ensureMeshAgentContainer(engine, { image: "agent:1" })).toBe("created");
		const spec = meshAgentContainerSpec({ image: "agent:1" }) as { HostConfig: { NetworkMode: string; CapAdd: string[]; RestartPolicy: { Name: string } } };
		expect(spec.HostConfig).toMatchObject({ NetworkMode: "host", CapAdd: ["NET_ADMIN"], RestartPolicy: { Name: "unless-stopped" } });
	});

	it("leaves a running agent on the right image alone", async () => {
		const engine = new Engine();
		engine.container = { id: "a", running: true, image: "agent:1", managed: true, env: [] };
		expect(await ensureMeshAgentContainer(engine, { image: "agent:1" })).toBe("running");
		expect(engine.calls).toEqual([]);
	});

	it("replaces an agent on another image (an upgrade)", async () => {
		const engine = new Engine();
		engine.container = { id: "a", running: true, image: "agent:0", managed: true, env: [] };
		expect(await ensureMeshAgentContainer(engine, { image: "agent:1" })).toBe("replaced");
		expect(engine.calls).toEqual(["remove", "create", "start"]);
	});

	it("replaces the agent when only its ENV differs — flipping the dataplane must take effect", async () => {
		const engine = new Engine();
		engine.container = { id: "a", running: true, image: "agent:1", managed: true, env: ["MESH_AGENT_DATAPLANE=kernel"] };
		expect(await ensureMeshAgentContainer(engine, { image: "agent:1", env: ["MESH_AGENT_DATAPLANE=observe"] })).toBe("replaced");
		expect(engine.calls).toEqual(["remove", "create", "start"]);
	});

	it("leaves the agent alone when its env matches, whatever the order", async () => {
		const engine = new Engine();
		engine.container = {
			id: "a",
			running: true,
			image: "agent:1",
			managed: true,
			env: ["MESH_AGENT_STUN_SERVERS=a", "MESH_AGENT_DATAPLANE=observe"],
		};
		const options = { image: "agent:1", env: ["MESH_AGENT_DATAPLANE=observe", "MESH_AGENT_STUN_SERVERS=a"] };
		expect(await ensureMeshAgentContainer(engine, options)).toBe("running");
		expect(engine.calls).toEqual([]);
	});

	it("always states the dataplane, so the effective value is readable off the container", () => {
		expect(meshAgentContainerEnv({ dataplane: "observe" })).toEqual(["MESH_AGENT_DATAPLANE=observe"]);
		expect(meshAgentContainerEnv({ dataplane: "kernel", declaredAddresses: ["203.0.113.4"] })).toEqual([
			"MESH_AGENT_DATAPLANE=kernel",
			"MESH_AGENT_DECLARED_ADDRESSES=203.0.113.4",
		]);
		// Empty lists are omitted rather than sent as an empty string, which the
		// agent would parse as a list containing one empty entry.
		expect(meshAgentContainerEnv({ dataplane: "kernel", declaredAddresses: [], stunServers: [] })).toEqual(["MESH_AGENT_DATAPLANE=kernel"]);
	});

	it("never removes a container it does not manage", async () => {
		const engine = new Engine();
		engine.container = { id: "x", running: true, image: "other", managed: false, env: [] };
		await expect(ensureMeshAgentContainer(engine, { image: "agent:1" })).rejects.toThrow(AGENT_CONTAINER_NAME);
		expect(engine.calls).toEqual([]);
	});
});
