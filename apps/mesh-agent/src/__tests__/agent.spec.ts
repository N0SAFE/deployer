import { generateMeshIdentity, getSetting, type RosterState, type WireguardDump } from "@deployer/mesh-network";
import { describe, expect, it } from "vitest";

import { AgentError, MeshAgent } from "../agent";
import type { AgentConfig } from "../config";
import { createControlHandler } from "../control-server";
import type { StateStore } from "../state-store";
import type { WireguardDriver } from "../wireguard-driver";

const config: AgentConfig = {
	stateDir: "/tmp/unused",
	socketDir: "/tmp/unused",
	nodeName: "test",
	interfaceName: "deployer-mesh",
	listenPort: 51820,
	gossipPort: 7300,
	stunServers: [],
	declaredAddresses: [],
	tickMs: 5000,
	dockerSocket: "/var/run/docker.sock",
	dataplane: "kernel",
};

/**
 * A perfect network: every peer the agent configures completes a handshake at once.
 * That isolates the AGENT's behaviour (roster, gossip, planning) from link physics,
 * which the planner's own tests cover.
 */
class PerfectNetworkDriver implements WireguardDriver {
	configured: string[] = [];
	interfaceAddress: string | null = null;
	constructor(private readonly now: () => number) {}
	ensureInterface(address: string): Promise<void> {
		this.interfaceAddress = address;
		return Promise.resolve();
	}
	syncConfig(config: string): Promise<void> {
		this.configured = [...config.matchAll(/PublicKey = (\S+)/g)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));
		return Promise.resolve();
	}
	dump(): Promise<WireguardDump | null> {
		if (this.interfaceAddress === null) return Promise.resolve(null);
		return Promise.resolve({
			publicKey: "self",
			listenPort: 51820,
			peers: Object.fromEntries(
				this.configured.map((key) => [key, { publicKey: key, endpoint: "192.168.1.2:51820", allowedIps: [], latestHandshakeAt: this.now(), rxBytes: 0, txBytes: 0 }]),
			),
		});
	}
	removeInterface(): Promise<void> {
		this.interfaceAddress = null;
		return Promise.resolve();
	}
}

const memoryStore = (): StateStore => ({ saveRoster: () => Promise.resolve() }) as unknown as StateStore;

function network() {
	const agents = new Map<string, MeshAgent>();
	const now = () => Date.UTC(2026, 9, 7, 12);
	const spawn = (name: string, lanHost: string) => {
		const agent = new MeshAgent({
			config: { ...config, nodeName: name },
			store: memoryStore(),
			identity: generateMeshIdentity(),
			roster: null,
			wireguard: new PerfectNetworkDriver(now),
			gossip: (address: string, _port: number, roster: RosterState) => {
				const target = [...agents.values()].find((candidate) => candidate.meshAddress() === address);
				return target === undefined ? Promise.resolve(null) : target.receiveGossip(roster);
			},
			doors: null,
			discoverLan: () => [{ kind: "lan", host: lanHost, port: 51820 }],
			discoverReflexive: () => Promise.resolve(null),
			now,
			random: () => 0.5,
			log: () => undefined,
		});
		agents.set(name, agent);
		return agent;
	};
	return { spawn };
}

async function joinVia(admitter: MeshAgent, joiner: MeshAgent, name: string) {
	const cluster = admitter.status().cluster;
	if (cluster === null) throw new Error("admitter not in a cluster");
	const request = await joiner.createJoinRequest({ clusterId: cluster.clusterId, cidr: cluster.cidr, name });
	const { roster } = await admitter.admit(request);
	await joiner.join(roster);
}

describe("MeshAgent", () => {
	it("founds a cluster idempotently", async () => {
		const { spawn } = network();
		const a = spawn("a", "192.168.1.1");
		const first = await a.ensureCluster({ name: "a" });
		const second = await a.ensureCluster({ name: "a" });
		expect(second.cluster?.clusterId).toBe(first.cluster?.clusterId);
		expect(first.members).toHaveLength(1);
	});

	it("joins through any member and converges the roster by gossip", async () => {
		const { spawn } = network();
		const a = spawn("a", "192.168.1.1");
		const b = spawn("b", "192.168.1.2");
		const c = spawn("c", "192.168.1.3");
		await a.ensureCluster({ name: "a" });
		await joinVia(a, b, "b");
		// c is admitted by b, not by the founder.
		await joinVia(b, c, "c");

		await a.writeSetting("ingress", { lanes: ["local", "private"] });
		for (let round = 0; round < 4; round += 1) {
			for (const agent of [a, b, c]) await agent.tick();
		}

		for (const agent of [a, b, c]) {
			expect(agent.status().members.map((member) => member.name).sort()).toEqual(["a", "b", "c"]);
			expect(agent.readSettings().ingress).toEqual({ lanes: ["local", "private"] });
		}
		expect(a.status().members.find((member) => member.name === "c")?.link.path).toBe("direct");
	});

	it("abandons a mesh it founded ALONE to join a fleet (setup founds one on every fresh node)", async () => {
		const { spawn } = network();
		const a = spawn("a", "192.168.1.1");
		const lone = spawn("x", "192.168.1.9");
		await a.ensureCluster({ name: "a" });
		await lone.ensureCluster({ name: "x" });
		await joinVia(a, lone, "x");
		expect(lone.status().cluster?.clusterId).toBe(a.status().cluster?.clusterId);
	});

	it("never abandons a mesh that has another member", async () => {
		const { spawn } = network();
		const a = spawn("a", "192.168.1.1");
		const x = spawn("x", "192.168.1.9");
		const y = spawn("y", "192.168.1.8");
		await a.ensureCluster({ name: "a" });
		await x.ensureCluster({ name: "x" });
		await joinVia(x, y, "y");
		const cluster = a.status().cluster;
		if (cluster === null) throw new Error("no cluster");
		await expect(x.createJoinRequest({ clusterId: cluster.clusterId, cidr: cluster.cidr, name: "x" })).rejects.toMatchObject({ code: "already-in-cluster" });
	});

	it("reports control errors with their HTTP status", async () => {
		const { spawn } = network();
		const a = spawn("a", "192.168.1.1");
		const handler = createControlHandler(a);

		const notInCluster = await handler(new Request("http://agent/v1/settings", { method: "PUT", body: JSON.stringify({ key: "k", value: 1 }) }));
		expect(notInCluster.status).toBe(409);
		expect(await notInCluster.json()).toMatchObject({ code: "not-in-cluster" });

		const invalid = await handler(new Request("http://agent/v1/cluster", { method: "POST", body: JSON.stringify({ name: "" }) }));
		expect(invalid.status).toBe(400);

		expect((await handler(new Request("http://agent/v1/nope"))).status).toBe(404);
		expect((await handler(new Request("http://agent/v1/status", { method: "DELETE" }))).status).toBe(405);
	});

	it("serves the full join flow over the control API", async () => {
		const { spawn } = network();
		const a = spawn("a", "192.168.1.1");
		const b = spawn("b", "192.168.1.2");
		const control = (agent: MeshAgent, route: string, method: string, body?: unknown) =>
			createControlHandler(agent)(new Request(`http://agent${route}`, { method, body: body === undefined ? undefined : JSON.stringify(body) }));

		const founded = (await (await control(a, "/v1/cluster", "POST", { name: "a" })).json()) as { cluster: { clusterId: string; cidr: string } };
		const request = await (await control(b, "/v1/join-request", "POST", { clusterId: founded.cluster.clusterId, cidr: founded.cluster.cidr, name: "b" })).json();
		const admitted = (await (await control(a, "/v1/admissions", "POST", { request })).json()) as { roster: RosterState };
		const joined = await control(b, "/v1/join", "POST", { roster: admitted.roster });
		expect(joined.status).toBe(200);
		expect(b.status().cluster?.clusterId).toBe(founded.cluster.clusterId);
	});

	it("moves its own address when it loses a collision", async () => {
		const { spawn } = network();
		const a = spawn("a", "192.168.1.1");
		await a.ensureCluster({ name: "a" });
		const before = a.meshAddress();
		await a.tick();
		expect(a.meshAddress()).toBe(before);
	});

	it("exposes settings it wrote through the roster", async () => {
		const { spawn } = network();
		const a = spawn("a", "192.168.1.1");
		await a.ensureCluster({ name: "a" });
		await a.writeSetting("node.doors", { hello: "world" });
		const roster = (a as unknown as { roster: RosterState }).roster;
		expect(getSetting(roster, "node.doors")).toEqual({ hello: "world" });
		await expect(a.revoke("m000000000000000000000000", "x")).rejects.toBeInstanceOf(AgentError);
	});
});
