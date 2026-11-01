import { DatabaseSync } from "node:sqlite";

import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { AgentOverlay } from "@deployer/node-agent-contracts";

import { AgentStore, agentStoreOver } from "../local/agent-store";
import { NodeAgents } from "../modules/mesh/services/node-agents.service";
import { NodeIdentity } from "../modules/mesh/services/node-identity.service";
import { AdvertisedAddress } from "../modules/mesh/services/roster-gossip.service";

// No real interface on the test host: the LAN source is decided by each case.
vi.mock("./host-addresses", () => ({
	lanAddresses: () => [],
}));

import {
	OVERLAY_PREFIX_LENGTH,
	OVERLAY_SALT_SECRET,
	OVERLAY_SELF_SECRET,
	WIREGUARD_PRIVATE_KEY_SECRET,
	WIREGUARD_PUBLIC_KEY_SECRET,
	overlayAddressFor,
	parseOverlaySelf,
	settleOverlayAddress,
} from "./overlay";
import { OverlaySettings, WireguardTick, type WireguardConvergence } from "./wireguard-tick.service";
import { HostCommands, WireguardDriver, WireguardPaths, type WireguardDriverShape } from "./wireguard.service";

const PEER: AgentOverlay = {
	wireguardKey: "PEERKEY",
	meshAddress: "10.88.2.3",
	endpoint: "peer.example:51820",
	listenPort: 51820,
};

const SELF_OVERLAY: AgentOverlay = {
	wireguardKey: "SELFKEY",
	meshAddress: "10.88.9.9",
	endpoint: "self.example:51820",
	listenPort: 51820,
};

function agent(nodeId: string, overlay: AgentOverlay | null) {
	return { nodeId, address: `ws://${nodeId}`, overlay, labels: {} };
}

function harness(
	options: {
		nodeId?: string;
		advertised?: string;
		listenPort?: number;
		declared?: readonly string[];
		stunServers?: readonly string[];
		agents?: readonly ReturnType<typeof agent>[];
	} = {},
) {
	const nodeId = options.nodeId ?? "node-self";
	const store = agentStoreOver(new DatabaseSync(":memory:") as never);
	const calls: string[] = [];
	const configs: string[] = [];
	let generated = 0;

	const driver: WireguardDriverShape = {
		ensureInterface: (address, prefix) =>
			Effect.sync(() => {
				calls.push(`ensure ${address}/${String(prefix)}`);
			}),
		syncConfig: (config) =>
			Effect.sync(() => {
				configs.push(config);
			}),
		dump: () => Effect.succeed(null),
		generateKeypair: () =>
			Effect.sync(() => {
				generated += 1;
				return { privateKey: `priv-${String(generated)}`, publicKey: `pub-${String(generated)}` };
			}),
		removeInterface: () => Effect.void,
	};

	const agents = new NodeAgents.live(new Map((options.agents ?? []).map((entry) => [entry.nodeId, entry])));
	const commands = {
		run: () => Effect.succeed({ code: 0, stdout: "", stderr: "" }),
		runWithInput: () => Effect.succeed({ code: 0, stdout: "", stderr: "" }),
	};

	const run = () =>
		Effect.runPromise(
			Effect.flatMap(WireguardTick, (tick) => tick.convergeOnce()).pipe(
				Effect.provideService(WireguardTick, new WireguardTick.live()),
				Effect.provideService(AgentStore, store),
				Effect.provideService(NodeIdentity, { nodeId }),
				Effect.provideService(NodeAgents, agents),
				Effect.provideService(AdvertisedAddress, {
					address: options.advertised ?? "ws://node.example:7000/mesh/ws",
				}),
				Effect.provideService(OverlaySettings, {
					listenPort: options.listenPort ?? 51820,
					declared: options.declared ?? [],
					stunServers: options.stunServers ?? [],
				}),
				Effect.provideService(WireguardDriver, driver),
				Effect.provideService(WireguardPaths, { interfaceName: "wg-test", configPath: "/tmp/mesh-wg-test.conf" }),
				Effect.provideService(HostCommands, commands),
			) as Effect.Effect<WireguardConvergence>,
		);

	const secret = (name: string) => Effect.runPromise(store.secret(name));

	return {
		nodeId,
		calls,
		configs,
		get generated() {
			return generated;
		},
		run,
		secret,
	};
}

describe("WireguardTick", () => {
	it("generates its keys once, advertises itself and applies the peers' plan", async () => {
		const tick = harness({ agents: [agent("peer-1", PEER)] });
		const settled = settleOverlayAddress(tick.nodeId, 0, new Map([["peer-1", PEER.meshAddress]]));

		const result = await tick.run();

		expect(result).toEqual({ applied: true, address: settled.address, peers: 1, salt: settled.salt });
		expect(tick.generated).toBe(1);
		expect(await tick.secret(WIREGUARD_PRIVATE_KEY_SECRET)).toBe("priv-1");
		expect(await tick.secret(WIREGUARD_PUBLIC_KEY_SECRET)).toBe("pub-1");
		expect(parseOverlaySelf(await tick.secret(OVERLAY_SELF_SECRET))).toEqual({
			wireguardKey: "pub-1",
			meshAddress: settled.address,
			endpoint: "node.example:51820",
			listenPort: 51820,
		});
		expect(tick.calls).toEqual([`ensure ${settled.address}/${String(OVERLAY_PREFIX_LENGTH)}`]);
		expect(tick.configs).toHaveLength(1);
		expect(tick.configs[0]).toContain("PrivateKey = priv-1");
		expect(tick.configs[0]).toContain("ListenPort = 51820");
		expect(tick.configs[0]).toContain("PublicKey = PEERKEY");
		expect(tick.configs[0]).toContain("AllowedIPs = 10.88.2.3/32");
		expect(tick.configs[0]).toContain("Endpoint = peer.example:51820");
		expect(tick.configs[0]).toContain("PersistentKeepalive = 25");
	});

	it("excludes itself and skips a peer with no overlay", async () => {
		const tick = harness({ agents: [agent("node-self", SELF_OVERLAY), agent("peer-null", null), agent("peer-1", PEER)] });

		const result = await tick.run();

		expect(result.applied && result.peers).toBe(1);
		expect(tick.configs[0]).not.toContain("SELFKEY");
		expect(tick.configs[0]?.match(/\[Peer\]/g)).toHaveLength(1);
	});

	it("moves to the next salt when a lower node id holds its address, and remembers it", async () => {
		const held = overlayAddressFor("node-self", 0);
		const tick = harness({ agents: [agent("aaa", { ...PEER, meshAddress: held })] });

		const result = await tick.run();

		expect(result.applied).toBe(true);
		if (!result.applied) throw new Error("expected the pass to apply");
		expect(result.salt).toBeGreaterThan(0);
		expect(result.address).not.toBe(held);
		expect(await tick.secret(OVERLAY_SALT_SECRET)).toBe(String(result.salt));
		expect(tick.calls).toEqual([`ensure ${result.address}/${String(OVERLAY_PREFIX_LENGTH)}`]);
	});

	it("applies nothing when the advertised address names no host", async () => {
		const tick = harness({ advertised: "not-a-url" });

		const result = await tick.run();

		expect(result).toEqual({ applied: false, reason: "no-endpoint" });
		expect(tick.generated).toBe(0);
		expect(tick.calls).toEqual([]);
		expect(tick.configs).toEqual([]);
		expect(await tick.secret(WIREGUARD_PRIVATE_KEY_SECRET)).toBeUndefined();
	});

	it("advertises a declared address when the URL names no host, and applies", async () => {
		const tick = harness({ advertised: "not-a-url", declared: ["203.0.113.7"] });

		const result = await tick.run();

		expect(result.applied).toBe(true);
		expect(tick.configs).toHaveLength(1);
		expect(parseOverlaySelf(await tick.secret(OVERLAY_SELF_SECRET))?.endpoint).toBe("203.0.113.7:51820");
	});

	it("applies nothing when neither the URL nor declared nor LAN nor STUN names an endpoint", async () => {
		const tick = harness({ advertised: "" });

		expect(await tick.run()).toEqual({ applied: false, reason: "no-endpoint" });
		expect(tick.configs).toEqual([]);
	});

	it("reuses the stored keys on the next pass", async () => {
		const tick = harness({ agents: [agent("peer-1", PEER)] });

		await tick.run();
		await tick.run();

		expect(tick.generated).toBe(1);
		expect(tick.configs).toHaveLength(2);
		expect(tick.configs[1]).toContain("PrivateKey = priv-1");
		expect(await tick.secret(WIREGUARD_PUBLIC_KEY_SECRET)).toBe("pub-1");
	});
});
