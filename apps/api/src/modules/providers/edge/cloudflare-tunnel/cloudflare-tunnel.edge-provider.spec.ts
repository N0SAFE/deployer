import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicLane } from "@deployer/contracts-entities/entities/ingress/index";

import type { EnvService } from "@/config/env/env.module";
import type { EdgeContext } from "@/core/modules/edge/edge-provider";
import { EdgeProviderRegistry } from "@/core/modules/edge/edge-provider.registry";
import type { EdgeStateStore } from "@/core/modules/edge/edge-state.store";
import type { CloudflareTunnelService } from "../../dns/cloudflare/services/cloudflare-tunnel.service";

import { CLOUDFLARE_TUNNEL_EDGE_ID, CloudflareTunnelEdgeProvider } from "./cloudflare-tunnel.edge-provider";

const lane = (account: string, domain = "apps.example.com"): PublicLane => ({
	provider: CLOUDFLARE_TUNNEL_EDGE_ID,
	domain,
	acknowledgedInboundPorts: false,
	options: { account },
});

const ctx = (l: PublicLane): EdgeContext => ({ lane: l, ingressTarget: "http://deployer-traefik:8002", nodes: [], resourceName: "deployer-stack" });

function setup(initial: unknown = null) {
	let state: unknown = initial;
	const store = {
		read: vi.fn(() => Promise.resolve(state)),
		write: vi.fn((_id: string, _schema: unknown, value: unknown) => {
			state = value;
			return Promise.resolve(value);
		}),
		clear: vi.fn(() => {
			state = null;
			return Promise.resolve();
		}),
	} as unknown as EdgeStateStore;
	const tunnels = {
		createTunnel: vi.fn(() => Promise.resolve({ tunnel: { id: "tun-new" }, token: "tok-new" })),
		configureIngress: vi.fn(() => Promise.resolve()),
		deleteTunnel: vi.fn(() => Promise.resolve(true)),
		getTunnelHealth: vi.fn(() => Promise.resolve({ status: "healthy", checkedAt: "", connections: 2, error: null })),
	} as unknown as CloudflareTunnelService;
	const env = { get: vi.fn((key: string) => (key === "DEPLOYER_CLOUDFLARED_REPLICAS" ? 2 : "cloudflare/cloudflared:2025.1.0")) } as unknown as EnvService;
	const registry = new EdgeProviderRegistry();
	const provider = new CloudflareTunnelEdgeProvider(registry, tunnels, store, env);
	return { provider, registry, tunnels, store, getState: () => state };
}

const existing = { accountId: "acc-1", tunnelId: "tun-1", token: "tok-1", wildcard: "*.apps.example.com" };

describe("CloudflareTunnelEdgeProvider", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("registers itself as an outbound tunnel edge that opens no port", () => {
		const { registry } = setup();
		const descriptor = registry.get(CLOUDFLARE_TUNNEL_EDGE_ID).descriptor;
		expect(descriptor).toMatchObject({ kind: "tunnel", opensInboundPorts: false, usesProviderAccount: true });
		expect(registry.ingressPlan({ entryPort: 80, private: { enabled: false, domain: "d.internal", exposeOnLan: false }, public: lane("a"), consoleVisibility: "public" })).toEqual({
			publishedPorts: [],
			tls: "edge",
		});
	});

	it("creates ONE stack tunnel and routes the wildcard to Traefik — no DNS here", async () => {
		const { provider, tunnels, getState } = setup();
		await provider.provision(ctx(lane("acc-1")));
		expect(tunnels.createTunnel).toHaveBeenCalledWith("acc-1", { name: "deployer-stack" });
		expect(tunnels.configureIngress).toHaveBeenCalledWith("acc-1", "tun-new", "*.apps.example.com", "http://deployer-traefik:8002");
		expect(getState()).toEqual({ accountId: "acc-1", tunnelId: "tun-new", token: "tok-new", wildcard: "*.apps.example.com" });
	});

	it("reuses the tunnel on re-provision and only re-routes a new domain", async () => {
		const { provider, tunnels, getState } = setup(existing);
		await provider.provision(ctx(lane("acc-1", "new.example.com")));
		expect(tunnels.createTunnel).not.toHaveBeenCalled();
		expect(tunnels.configureIngress).toHaveBeenCalledWith("acc-1", "tun-1", "*.new.example.com", "http://deployer-traefik:8002");
		expect(getState()).toMatchObject({ tunnelId: "tun-1", wildcard: "*.new.example.com" });
	});

	it("deletes the old tunnel before moving to another account", async () => {
		const { provider, tunnels } = setup(existing);
		await provider.provision(ctx(lane("acc-2")));
		expect(tunnels.deleteTunnel).toHaveBeenCalledWith("acc-1", "tun-1");
		expect(tunnels.createTunnel).toHaveBeenCalledWith("acc-2", { name: "deployer-stack" });
	});

	it("runs a connector with the token in the environment, never in argv", async () => {
		const { provider } = setup(existing);
		const spec = await provider.connector(ctx(lane("acc-1")));
		expect(spec).toMatchObject({ env: ["TUNNEL_TOKEN=tok-1"], replicas: 2 });
		expect(JSON.stringify([spec?.command, spec?.args])).not.toContain("tok-1");
		// A tunnel on another account than the lane names is not ours to run.
		expect(await provider.connector(ctx(lane("acc-2")))).toBeNull();
	});

	it("asks for a proxied wildcard CNAME on the tunnel's own account", async () => {
		const { provider } = setup(existing);
		expect(await provider.dnsRecords(ctx(lane("acc-1")))).toEqual([
			{ name: "*.apps.example.com", type: "CNAME", contents: ["tun-1.cfargotunnel.com"], proxied: true, preferredAccountId: "acc-1" },
		]);
	});

	it("reports health and connections, and joinability only once provisioned", async () => {
		const { provider } = setup(existing);
		const status = await provider.status(ctx(lane("acc-1")));
		expect(status).toMatchObject({ provisioned: true, health: "healthy" });
		expect(provider.joinPath(ctx(lane("acc-1")), status)).toMatchObject({ available: true, sources: 2, target: "https://api.apps.example.com" });
		const empty = setup().provider;
		const none = await empty.status(ctx(lane("acc-1")));
		expect(none.provisioned).toBe(false);
		expect(empty.joinPath(ctx(lane("acc-1")), none).available).toBe(false);
	});

	it("tears down provider-first, then forgets", async () => {
		const { provider, tunnels, store } = setup(existing);
		await provider.teardown();
		expect(tunnels.deleteTunnel).toHaveBeenCalledWith("acc-1", "tun-1");
		expect(store.clear).toHaveBeenCalled();
		vi.mocked(tunnels.deleteTunnel).mockClear();
		await provider.teardown();
		expect(tunnels.deleteTunnel).not.toHaveBeenCalled();
	});

	it("forgets the stack tunnel only when the deleted one is it", async () => {
		const { provider, store } = setup(existing);
		expect(await provider.forgetDeletedTunnel("acc-1", "other")).toBe(false);
		expect(store.clear).not.toHaveBeenCalled();
		expect(await provider.forgetDeletedTunnel("acc-1", "tun-1")).toBe(true);
	});
});
