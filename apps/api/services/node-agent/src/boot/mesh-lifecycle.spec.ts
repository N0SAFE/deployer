import { Effect } from "effect";
import { afterAll, describe, expect, it, vi } from "vitest";

import { type nodeAgentContract } from "@deployer/node-agent-contracts";
import { createMeshClient, openWebSocketConnection, pooledLink } from "@deployer/mesh-client";

import { type BootedAgent, bootAgent, removeDataDir } from "./boot-agent";

import type { ContractRouterClient } from "@orpc/contract";
import type { ClientContext } from "@orpc/client";

type NodeAgentClient = ContractRouterClient<typeof nodeAgentContract>;

const SECRET = "mesh-lifecycle-spec-secret-at-least-32-chars";

/**
 * The swarm's own lifecycle over real sockets: a member rotates the credential and every other member keeps working
 * through the grace window, and a member is cut out of the roster without stopping the node that blocked it.
 */
describe("mesh lifecycle over real sockets", () => {
	const running: BootedAgent[] = [];
	const dirs: string[] = [];

	afterAll(async () => {
		await Promise.all(running.map((agent) => agent.stop().catch(() => undefined)));
		dirs.forEach(removeDataDir);
	});

	async function boot(pin?: { nodeId?: string; seeds?: string[] }): Promise<BootedAgent> {
		const agent = await bootAgent({ pin: { ...pin, secret: SECRET } });
		running.push(agent);
		dirs.push(agent.dataDir);
		return agent;
	}

	const peer = (agent: BootedAgent, credential = SECRET) =>
		pooledLink<ClientContext>({
			target: agent.ws,
			maxConnections: 1,
			multiplex: 4,
			idleMs: 1_000,
			open: () =>
				Promise.resolve(openWebSocketConnection({ url: `${agent.ws}?credential=${credential}`, reconnectDelayMs: 20 })),
		});

	const client = (link: ReturnType<typeof peer>) => createMeshClient<NodeAgentClient>(link);

	it("rotates the credential and every member keeps working through the grace window", async () => {
		const a = await boot({ nodeId: "node-a" });
		const b = await boot({ nodeId: "node-b", seeds: [a.ws] });
		const toA = peer(a);
		const toB = peer(b);

		// B found A through the seed and learned it; A learned B from B's view.
		await vi.waitFor(async () => {
			const view = (await Effect.runPromise(client(toA).roster.view({}))) as { agents: { nodeId: string }[] };
			expect(view.agents.some((agent) => agent.nodeId === "node-b")).toBe(true);
		});

		const rotated = await Effect.runPromise(client(toA).roster.rotate({}));
		expect(rotated.rotated).toBe(true);
		expect(rotated.epoch).toBeGreaterThan(0);

		// A's new credential is what B converges on (its view carries the epoch, then it fetches the secret).
		const aCredential = (await Effect.runPromise(client(toA).roster.credential({}))) as { secret: string };
		await vi.waitFor(async () => {
			const current = (await Effect.runPromise(client(peer(b, aCredential.secret)).roster.credential({}))) as { secret: string; epoch: number };
			expect(current.secret).not.toBe(SECRET);
			expect(current.epoch).toBe(rotated.epoch);
		});

		// The replaced secret is still accepted by the node that adopted the rotation, inside the grace window.
		await expect(Effect.runPromise(client(peer(b, SECRET)).roster.credential({}))).resolves.toMatchObject({
			secret: aCredential.secret,
		});
		// Both the old (grace) and the new credential still reach A; a stranger does not.
		await expect(Effect.runPromise(client(toA).roster.credential({}))).resolves.toMatchObject({ epoch: rotated.epoch });
		await expect(Effect.runPromise(client(peer(a, "not-the-secret")).roster.credential({}))).rejects.toBeDefined();

		await Promise.all([toA.closeAll(), toB.closeAll()]);
	});

	it("blocks a member out of the roster, and unblocks it", async () => {
		const a = await boot({ nodeId: "node-a" });
		const b = await boot({ nodeId: "node-b", seeds: [a.ws] });
		const toA = peer(a);

		await vi.waitFor(async () => {
			const view = (await Effect.runPromise(client(toA).roster.view({}))) as { agents: { nodeId: string }[] };
			expect(view.agents.some((agent) => agent.nodeId === "node-b")).toBe(true);
		});

		await expect(Effect.runPromise(client(toA).roster.block({ nodeId: "node-b" }))).resolves.toEqual({
			blocked: ["node-b"],
		});

		const afterBlock = (await Effect.runPromise(client(toA).roster.view({}))) as { agents: { nodeId: string }[] };
		expect(afterBlock.agents.some((agent) => agent.nodeId === "node-b")).toBe(false);

		// The blocked node is not re-learned from its own gossip.
		await new Promise((resolve) => setTimeout(resolve, 300));
		const stillBlocked = (await Effect.runPromise(client(toA).roster.view({}))) as { agents: { nodeId: string }[] };
		expect(stillBlocked.agents.some((agent) => agent.nodeId === "node-b")).toBe(false);

		await expect(Effect.runPromise(client(toA).roster.unblock({ nodeId: "node-b" }))).resolves.toEqual({ blocked: [] });
		await vi.waitFor(async () => {
			const view = (await Effect.runPromise(client(toA).roster.view({}))) as { agents: { nodeId: string }[] };
			expect(view.agents.some((agent) => agent.nodeId === "node-b")).toBe(true);
		});

		await toA.closeAll();
	});
});
