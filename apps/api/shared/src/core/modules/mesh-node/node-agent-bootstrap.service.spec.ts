import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { makeNodeAgentBootstrap } from "./node-agent-bootstrap.service";

import type { DockerEngineShape } from "@deployer/docker";
import type { NodeDoorClient } from "@deployer/mesh-client";
import type { NodeConfigRepositoryShape } from "@deployer/node-state";

function build(setupState: string) {
	const labels = vi.fn(() => Promise.resolve({}));
	const status = vi.fn(() => Promise.resolve({ agentId: "a", interfaceUp: true }));
	const door = { labels, status } as unknown as NodeDoorClient;
	const nodeConfig = { find: () => Effect.succeed({ setupState, nodeId: "n1" }) } as unknown as NodeConfigRepositoryShape;
	const shape = makeNodeAgentBootstrap({
		docker: {} as DockerEngineShape,
		nodeConfig,
		door,
		settings: { swarmMode: () => "true", image: () => undefined, doorSocket: () => undefined },
	});
	return { shape, labels, status };
}

describe("NodeAgentBootstrap", () => {
	it("does nothing before setup is done", async () => {
		const { shape, status } = build("pending");
		await Effect.runPromise(shape.ensure());
		expect(status).not.toHaveBeenCalled();
	});

	it("in swarm mode reads the door and labels the node", async () => {
		const { shape, labels } = build("setup_done");
		await Effect.runPromise(shape.ensure());
		expect(labels).toHaveBeenCalledWith({ "deployer.node-id": "n1" });
	});

	it("never fails when a step blows up", async () => {
		const { shape, status } = build("setup_done");
		status.mockImplementation(() => Promise.reject(new Error("boom")));
		await expect(Effect.runPromise(shape.ensure())).resolves.toBeUndefined();
	});
});
