import { describe, expect, it } from "vitest";
import { defaultIngressLanes, type PublicLane } from "@deployer/contracts-entities/entities/ingress/index";

import type { EdgeContext } from "@/core/modules/edge/edge-provider";
import { NO_PUBLIC_EDGE } from "@/core/modules/edge/edge-provider.registry";
import { TEST_TUNNEL_ID, testEdgeRegistry, TestTunnelEdgeProvider } from "@/core/modules/edge/testing/edge-registry.fixture";

const direct = (options: PublicLane["options"] = {}, acknowledgedInboundPorts = true): PublicLane => ({
	provider: "direct",
	domain: "apps.example.com",
	acknowledgedInboundPorts,
	options,
});

describe("EdgeProviderRegistry", () => {
	it("lists the catalog with port-opening providers last", () => {
		const { registry } = testEdgeRegistry();
		expect(registry.descriptors().map((d) => d.id)).toEqual([TEST_TUNNEL_ID, "direct"]);
	});

	it("refuses a provider registered twice", () => {
		const { registry } = testEdgeRegistry();
		expect(() => registry.register(new TestTunnelEdgeProvider())).toThrow(/registered twice/);
	});

	describe("normalize", () => {
		it("fills boolean defaults and drops nothing it was given", () => {
			const { registry } = testEdgeRegistry();
			expect(registry.normalize(direct()).options).toEqual({ tls: true });
			expect(registry.normalize(direct({ tls: false })).options).toEqual({ tls: false });
		});

		it("requires the operator's acknowledgement for a provider that opens ports", () => {
			const { registry } = testEdgeRegistry();
			expect(() => registry.normalize(direct({}, false))).toThrow(/acknowledgedInboundPorts/);
		});

		it("never records an acknowledgement a provider does not need", () => {
			const { registry } = testEdgeRegistry();
			const lane = registry.normalize({ provider: TEST_TUNNEL_ID, domain: "a.example.com", acknowledgedInboundPorts: true, options: { account: "x" } });
			expect(lane.acknowledgedInboundPorts).toBe(false);
		});

		it("rejects unknown providers, unknown options, wrong types and missing required options", () => {
			const { registry } = testEdgeRegistry();
			expect(() => registry.normalize({ ...direct(), provider: "nope" })).toThrow(/Unknown edge provider/);
			expect(() => registry.normalize(direct({ port: 8080 }))).toThrow(/does not take/);
			expect(() => registry.normalize(direct({ tls: "yes" }))).toThrow(/true or false/);
			expect(() =>
				registry.normalize({ provider: TEST_TUNNEL_ID, domain: "a.example.com", acknowledgedInboundPorts: false, options: {} }),
			).toThrow(/required/);
		});
	});

	describe("ingressPlan", () => {
		it("publishes nothing without a public lane, or for an unknown provider", () => {
			const { registry } = testEdgeRegistry();
			expect(registry.ingressPlan(defaultIngressLanes())).toEqual(NO_PUBLIC_EDGE);
			expect(registry.ingressPlan({ ...defaultIngressLanes(), public: { ...direct(), provider: "gone" } })).toEqual(NO_PUBLIC_EDGE);
		});

		it("publishes :80/:443 for direct with TLS, :80 only without", () => {
			const { registry } = testEdgeRegistry();
			expect(registry.ingressPlan({ ...defaultIngressLanes(), public: direct({ tls: true }) })).toEqual({
				publishedPorts: [
					{ published: 80, entrypoint: "public" },
					{ published: 443, entrypoint: "public-tls" },
				],
				tls: "acme",
			});
			expect(registry.ingressPlan({ ...defaultIngressLanes(), public: direct({ tls: false }) }).publishedPorts).toHaveLength(1);
		});

		it("publishes no port that was not acknowledged, even from a hand-edited setting", () => {
			const { registry } = testEdgeRegistry();
			expect(registry.ingressPlan({ ...defaultIngressLanes(), public: direct({ tls: true }, false) }).publishedPorts).toEqual([]);
		});
	});

	it("names the DNS accounts the public lane depends on", () => {
		const { registry } = testEdgeRegistry();
		const lanes = { ...defaultIngressLanes(), public: { provider: TEST_TUNNEL_ID, domain: "a.example.com", acknowledgedInboundPorts: false, options: { account: "acc-7" } } };
		expect(registry.accountsInUse(lanes)).toEqual(["acc-7"]);
		expect(registry.accountsInUse(defaultIngressLanes())).toEqual([]);
	});
});

describe("DirectEdgeProvider", () => {
	const ctx = (nodes: EdgeContext["nodes"]): EdgeContext => ({
		lane: direct({ tls: true }),
		ingressTarget: "http://deployer-traefik:8002",
		nodes,
		resourceName: "deployer-stack",
	});
	const provider = () => testEdgeRegistry().registry.get("direct");

	it("points the wildcard at every declared public IP — never at a hostname", async () => {
		const records = await provider().dnsRecords(
			ctx([
				{ nodeId: "a", publicAddress: "203.0.113.5", addressKind: "ip" },
				{ nodeId: "b", publicAddress: "203.0.113.4", addressKind: "ip" },
				{ nodeId: "c", publicAddress: "node-c.example.net", addressKind: "hostname" },
			]),
		);
		expect(records).toEqual([
			{ name: "*.apps.example.com", type: "A", contents: ["203.0.113.4", "203.0.113.5"], proxied: false, preferredAccountId: null },
		]);
	});

	it("is not provisioned, and offers no join path, until a node declares a public IP", async () => {
		const edge = provider();
		const status = await edge.status(ctx([]));
		expect(status).toMatchObject({ provisioned: false, health: "down" });
		expect(edge.joinPath(ctx([]), status).available).toBe(false);
		expect(await edge.dnsRecords(ctx([]))).toEqual([]);
	});

	it("runs no connector", async () => {
		expect(await provider().connector(ctx([]))).toBeNull();
	});
});
