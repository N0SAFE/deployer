import { Cause, Effect, Exit } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultIngressLanes, type IngressLanes } from "@deployer/contracts-entities/entities/ingress/index";

import type { EnvService } from "@deployer/shared/config/env/env.module";
import type { EdgeContext } from "@deployer/shared/core/modules/edge/edge-provider";
import { TEST_TUNNEL_ID, testEdgeRegistry } from "@deployer/shared/core/modules/edge/testing/edge-registry.fixture";
import type { MeshAgentClient } from "@deployer/shared/core/modules/mesh-agent/mesh-agent.client";
import { EnvHostnameService } from "@deployer/shared/core/modules/platform-ingress/services/hostname.service";
import type { IngressLanesService } from "@deployer/shared/core/modules/platform-ingress/services/ingress-lanes.service";
import type { NodeNetworkConfigRepository } from "@deployer/shared/core/modules/reachability/repositories/node-network-config.repository";
import { PublicEdgeService } from "@deployer/shared/core/modules/reachability/services/public-edge.service";
import type { TraefikConfigRefresher } from "@deployer/shared/core/modules/traefik/services/traefik-config-refresher.service";

import type { EdgeDnsServiceShape } from "./edge-dns.service";
import { makeIngressEdgeService } from "./ingress-edge.service";

/** Run an Effect and reject with the ORIGINAL failure, so `toThrow(/text/)` reads the real message. */
async function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
	const exit = await Effect.runPromiseExit(effect);
	if (Exit.isSuccess(exit)) return exit.value;
	throw Cause.squash(exit.cause);
}

const member = (memberId: string, name: string, address: string) => ({
	memberId,
	name,
	kind: "node" as const,
	address,
	state: "active" as const,
	endpoints: [{ kind: "lan" as const, host: "192.168.1.10", port: 51820 }],
	labels: { "swarm.node": `sw-${name}` },
	link: { path: memberId === "m1" ? ("self" as const) : ("direct" as const), endpoint: null, latestHandshakeAt: null },
});

function setup(initial: IngressLanes = defaultIngressLanes()) {
	let lanes = initial;
	const order: string[] = [];
	const lanesService = {
		getLanes: vi.fn(() => Promise.resolve(lanes)),
		setLanes: vi.fn((next: IngressLanes) => {
			order.push(`setLanes:${next.public?.provider ?? "none"}`);
			lanes = next;
			return Promise.resolve(next);
		}),
	} as unknown as IngressLanesService;
	const { registry, tunnel } = testEdgeRegistry();
	tunnel.provisioned = true;
	vi.spyOn(tunnel, "provision").mockImplementation((ctx: EdgeContext) => {
		order.push(`provision:${ctx.lane.provider}`);
		return Promise.resolve();
	});
	vi.spyOn(tunnel, "teardown").mockImplementation(() => {
		order.push("teardown:test-tunnel");
		return Promise.resolve();
	});
	vi.spyOn(tunnel, "dnsRecords").mockImplementation(() =>
		Promise.resolve(
			lanes.public?.provider === TEST_TUNNEL_ID
				? [{ name: `*.${lanes.public.domain}`, type: "CNAME" as const, contents: ["t.example"], proxied: true, preferredAccountId: "acc-1" }]
				: [],
		),
	);
	const nodeConfigs = { list: vi.fn(() => Promise.resolve([])) } as unknown as NodeNetworkConfigRepository;
	const env = { get: vi.fn(() => "") } as unknown as EnvService;
	const publicEdge = new PublicEdgeService(registry, nodeConfigs, env);
	const dns = {
		results: vi.fn(() => Effect.succeed([])),
		reconcile: vi.fn(() => Effect.succeed([])),
		removeRecords: vi.fn(() => Effect.void),
	} as unknown as EdgeDnsServiceShape;
	const mesh = {
		status: vi.fn(() =>
			Promise.resolve({
				memberId: "m1",
				signingKey: "k",
				wireguardKey: "w",
				cluster: { clusterId: "c1", cidr: "100.88.0.0/16", listenPort: 51820, address: "100.88.0.1", interfaceUp: true },
				members: [member("m1", "node-a", "100.88.0.1"), member("m2", "node-b", "100.88.0.2")],
				settingKeys: [],
				doors: [],
				lastGossipAt: null,
				lastError: null,
			}),
		),
		revoke: vi.fn(() => Promise.resolve()),
	} as unknown as MeshAgentClient;
	const refresher = { refresh: vi.fn() } as unknown as TraefikConfigRefresher;
	const service = makeIngressEdgeService({
		lanes: lanesService,
		edges: registry,
		publicEdge,
		dns,
		mesh,
		hostnames: new EnvHostnameService(env),
		refresher,
	});
	return { service, lanesService, tunnel, dns, mesh, refresher, order, getLanes: () => lanes };
}

const tunnelInput = { provider: TEST_TUNNEL_ID, domain: "apps.example.com", options: { account: "acc-1" } };

describe("IngressEdgeService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("getState", () => {
		it("reports a local-only install with the provider catalog and no active edge", async () => {
			const state = await run(setup().service.getState());
			expect(state.edge.active).toBeNull();
			expect(state.edge.providers.map((provider) => provider.id).sort()).toEqual(["direct", TEST_TUNNEL_ID]);
			expect(state.exposure.reachableFromInternet).toBe(false);
			expect(state.consoleUrls.public).toBeNull();
		});

		it("shows the mesh as seen by this node, marking itself and keeping member labels", async () => {
			const { mesh } = await run(setup().service.getState());
			expect(mesh.members.find((m) => m.self)?.name).toBe("node-a");
			expect(mesh.members.find((m) => m.memberId === "m2")).toMatchObject({ self: false, labels: { "swarm.node": "sw-node-b" } });
			expect(mesh.members[0]?.endpoints).toEqual([{ kind: "lan", address: "192.168.1.10:51820" }]);
		});

		it("takes the public join path from the active provider", async () => {
			const { service } = setup({ ...defaultIngressLanes(), public: { ...tunnelInput, acknowledgedInboundPorts: false } });
			const state = await run(service.getState());
			expect(state.entryPoints.points.find((point) => point.kind === "public")).toMatchObject({ via: "Test Tunnel", available: true });
		});
	});

	describe("update", () => {
		it("provisions the new edge BEFORE the lanes name it", async () => {
			const { service, order, refresher } = setup();
			await run(service.update({ public: tunnelInput }));
			expect(order).toEqual([`provision:${TEST_TUNNEL_ID}`, `setLanes:${TEST_TUNNEL_ID}`]);
			expect(refresher.refresh).toHaveBeenCalled();
		});

		it("leaves the lanes untouched when the new edge cannot be provisioned", async () => {
			const { service, tunnel, lanesService } = setup();
			vi.mocked(tunnel.provision).mockRejectedValueOnce(new Error("account refused"));
			await expect(run(service.update({ public: tunnelInput }))).rejects.toThrow("account refused");
			expect(lanesService.setLanes).not.toHaveBeenCalled();
		});

		it("switches providers new-first, old-last", async () => {
			const { service, order } = setup({ ...defaultIngressLanes(), public: { ...tunnelInput, acknowledgedInboundPorts: false } });
			await run(service.update({ public: { provider: "direct", domain: "apps.example.com", acknowledgedInboundPorts: true } }));
			expect(order).toEqual(["setLanes:direct", "teardown:test-tunnel"]);
		});

		it("still turns the public lane off when the old edge's provider is unreachable", async () => {
			const { service, tunnel, getLanes } = setup({ ...defaultIngressLanes(), public: { ...tunnelInput, acknowledgedInboundPorts: false } });
			vi.mocked(tunnel.teardown).mockRejectedValueOnce(new Error("provider down"));
			await run(service.update({ public: null }));
			expect(getLanes().public).toBeNull();
		});

		it("refuses an inbound edge without the operator's acknowledgement", async () => {
			const { service, lanesService } = setup();
			await expect(run(service.update({ public: { provider: "direct", domain: "apps.example.com" } }))).rejects.toThrow(/acknowledgedInboundPorts/);
			expect(lanesService.setLanes).not.toHaveBeenCalled();
		});

		it("refuses options the provider does not declare, and missing required ones", async () => {
			const { service } = setup();
			await expect(run(service.update({ public: { ...tunnelInput, options: { account: "a", bogus: true } } }))).rejects.toThrow(/bogus/);
			await expect(run(service.update({ public: { ...tunnelInput, options: {} } }))).rejects.toThrow(/Account/);
		});

		it("keeps the provider's options when only the domain changes", async () => {
			const { service, getLanes } = setup({ ...defaultIngressLanes(), public: { ...tunnelInput, acknowledgedInboundPorts: false } });
			await run(service.update({ public: { provider: TEST_TUNNEL_ID, domain: "new.example.com" } }));
			expect(getLanes().public).toMatchObject({ domain: "new.example.com", options: { account: "acc-1" } });
		});

		it("removes the DNS record of a domain the edge no longer serves", async () => {
			const { service, dns } = setup({ ...defaultIngressLanes(), public: { ...tunnelInput, acknowledgedInboundPorts: false } });
			await run(service.update({ public: { provider: TEST_TUNNEL_ID, domain: "new.example.com" } }));
			expect(dns.removeRecords).toHaveBeenCalledWith("*.apps.example.com", "acc-1");
			expect(dns.reconcile).toHaveBeenCalledWith([expect.objectContaining({ lane: "public", name: "*.new.example.com" })]);
		});

		it("enables the private lane without touching the public edge", async () => {
			const { service, tunnel, getLanes } = setup();
			await run(service.update({ private: { enabled: true, exposeOnLan: true } }));
			expect(getLanes().private).toEqual({ enabled: true, domain: "deployer.internal", exposeOnLan: true });
			expect(tunnel.provision).not.toHaveBeenCalled();
		});
	});

	describe("teardownPublicEdge", () => {
		it("tears the provider down, then turns the lane off and drops its records", async () => {
			const { service, order, dns, getLanes } = setup({ ...defaultIngressLanes(), public: { ...tunnelInput, acknowledgedInboundPorts: false } });
			await run(service.teardownPublicEdge());
			expect(order).toEqual(["teardown:test-tunnel", "setLanes:none"]);
			expect(getLanes().public).toBeNull();
			expect(dns.removeRecords).toHaveBeenCalledWith("*.apps.example.com", "acc-1");
		});

		it("reports a provider failure instead of pretending the edge is gone", async () => {
			const { service, tunnel, lanesService } = setup({ ...defaultIngressLanes(), public: { ...tunnelInput, acknowledgedInboundPorts: false } });
			vi.mocked(tunnel.teardown).mockRejectedValueOnce(new Error("provider down"));
			await expect(run(service.teardownPublicEdge())).rejects.toThrow("provider down");
			expect(lanesService.setLanes).not.toHaveBeenCalled();
		});
	});

	describe("revokeMeshMember", () => {
		it("revokes another member through this node's agent", async () => {
			const { service, mesh } = setup();
			await run(service.revokeMeshMember("m2", "decommissioned"));
			expect(mesh.revoke).toHaveBeenCalledWith("m2", "decommissioned");
		});

		it("refuses to revoke the node answering, and unknown members", async () => {
			const { service, mesh } = setup();
			await expect(run(service.revokeMeshMember("m1", "x"))).rejects.toThrow(/cannot revoke itself/);
			await expect(run(service.revokeMeshMember("m9", "x"))).rejects.toThrow(/No mesh member/);
			expect(mesh.revoke).not.toHaveBeenCalled();
		});
	});
});
