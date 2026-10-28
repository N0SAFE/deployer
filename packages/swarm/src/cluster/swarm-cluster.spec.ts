import { Cause, Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

import { makeSwarmCluster } from "./swarm-cluster";

async function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
	const exit = await Effect.runPromiseExit(effect);
	if (Exit.isSuccess(exit)) return exit.value;
	throw Cause.squash(exit.cause);
}

function docker(state: string, extra: Record<string, unknown> = {}) {
	const init = vi.fn(() => Effect.succeed("node-1" as never));
	const info = vi.fn(() => Effect.succeed({ LocalNodeState: state, ControlAvailable: false, NodeID: "", Nodes: 0, Managers: 0 } as never));
	return {
		init,
		info,
		engine: { swarmCluster: { info, init, inspect: vi.fn(), join: vi.fn(), leave: vi.fn() }, swarmNodes: { list: () => Effect.succeed([]) }, swarmServices: { list: () => Effect.succeed([]) }, ...extra } as never,
	};
}

describe("SwarmCluster", () => {
	it("passes the readiness gate only for an active engine", async () => {
		await expect(run(makeSwarmCluster(docker("active").engine).assertClusterReady())).resolves.toBeUndefined();
		await expect(run(makeSwarmCluster(docker("inactive").engine).assertClusterReady())).rejects.toMatchObject({ _tag: "SwarmUnavailable" });
	});

	it("founds a cluster when the engine is inactive", async () => {
		const { engine, init } = docker("inactive");

		await run(makeSwarmCluster(engine).ensureCluster({ AdvertiseAddr: "1.2.3.4:2377" }));

		expect(init).toHaveBeenCalledWith({ AdvertiseAddr: "1.2.3.4:2377" });
	});

	it("reports an inactive engine as a snapshot that carries its state, without probing the cluster", async () => {
		const { engine } = docker("inactive");

		const snapshot = await run(makeSwarmCluster(engine).getLocalClusterSnapshot());

		expect(snapshot).toEqual(expect.objectContaining({ localNodeState: "inactive", nodeCount: 0, clusterId: null }));
	});

	it("refuses to re-anchor a cluster with more than one node", async () => {
		const info = Effect.succeed({ LocalNodeState: "active", ControlAvailable: true, NodeID: "n1", Nodes: 2, Managers: 1 });
		const engine = {
			swarmCluster: { info: () => info, inspect: () => Effect.succeed({ ID: "c1", JoinTokens: null }), init: vi.fn() },
			swarmNodes: { list: () => Effect.succeed([]) },
			swarmServices: { list: () => Effect.succeed([]) },
		} as never;

		await expect(run(makeSwarmCluster(engine).reanchorLoneCluster("100.88.0.1"))).rejects.toMatchObject({ _tag: "SwarmUnavailable" });
	});
});
