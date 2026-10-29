import { provideTo } from "@deployer/effect-core";
import { BadGatewayException } from "@nestjs/common";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";
import { CloudflareTunnelService } from "./cloudflare-tunnel.service";
import { CloudflareAppService, type CloudflareAppServiceShape, type DnsProviderAppView } from "./cloudflare-app.service";
import { CloudflareDnsProviderService, type CloudflareDnsProviderServiceShape } from "./cloudflare-dns-provider.service";

/** Run an Effect and reject with the ORIGINAL failure, so `rejects.toBeInstanceOf(...)` reads the real error. */
async function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
	const exit = await Effect.runPromiseExit(effect);
	if (Exit.isSuccess(exit)) return exit.value;
	throw Cause.squash(exit.cause);
}

/**
 * The tunnel service over fake collaborators: the app service hands out the fake SDK client, the DNS
 * provider is never reached. The fakes need nothing from the context, so the leftover requirement is
 * discharged.
 */
function tunnelServiceOver(appService: object) {
	const over = provideTo(CloudflareTunnelService.live, (effect) =>
		effect.pipe(
			Effect.provideService(CloudflareAppService, appService as unknown as CloudflareAppServiceShape),
			Effect.provideService(CloudflareDnsProviderService, {} as unknown as CloudflareDnsProviderServiceShape),
		) as Effect.Effect<unknown>,
	);
	return over;
}

/**
 * `configureIngress` — the tunnel's public-hostname → service routing rules.
 *
 * These pin the two ways the payload can be rejected or destructive, neither of
 * which is reachable without a live Cloudflare account:
 *
 *   1. The API requires the FINAL rule to match all URLs. Sending only
 *      hostname-scoped rules fails with
 *      `400 code 1056 — "The last ingress rule must match all URLs
 *      (i.e. it should not have a hostname or path filter)"`, so the tunnel
 *      exists, its CNAME resolves, and routing still silently does nothing.
 *   2. Building a fresh array drops every other hostname routed through the
 *      same tunnel. The tunnel and CNAME keep looking healthy while requests
 *      for the dropped hostname answer 1033 "unable to resolve".
 */

type IngressRule = {
	hostname?: string;
	service: string;
}

/** Minimal stand-in for the SDK client, recording what the service sends. */
function fakeClient(existingRules: IngressRule[]) {
	const update = vi.fn().mockResolvedValue({});
	return {
		client: {
			zeroTrust: {
				tunnels: {
					cloudflared: {
						configurations: {
							get: vi.fn().mockResolvedValue({ config: { ingress: existingRules } }),
							update,
						},
					},
				},
			},
		},
		update,
	};
}

function buildService(existingRules: IngressRule[]) {
	const { client, update } = fakeClient(existingRules);
	const appService = {
		getAppView: vi.fn(() =>
			Effect.succeed({
				isActive: true,
				name: "main",
				features: { dnsManagement: true, tunnelManagement: true },
			} satisfies Partial<DnsProviderAppView>),
		),
		buildClient: vi.fn(() => Effect.succeed(client)),
		getOrResolveAccountId: vi.fn(() => Effect.succeed("account-1")),
	};
	return { service: tunnelServiceOver(appService), update };
}

/** The `ingress` array the service actually sent to Cloudflare. */
function sentIngress(update: ReturnType<typeof vi.fn>): IngressRule[] {
	const [, params] = update.mock.calls[0] as [string, { config: { ingress: IngressRule[] } }];
	return params.config.ingress;
}

describe("CloudflareTunnelService.configureIngress", () => {
	it("ends with a catch-all rule so Cloudflare accepts the configuration", async () => {
		const { service, update } = buildService([]);

		await run(service.configureIngress("p1", "tunnel-1", "node.example.com", "http://traefik:80"));

		const ingress = sentIngress(update);
		const last = ingress[ingress.length - 1];
		// The catch-all must carry NO hostname — that is the rule Cloudflare
		// enforces, and the reason the SDK's type cannot be used as-is.
		expect(last).toEqual({ service: "http_status:404" });
		expect(last).not.toHaveProperty("hostname");
	});

	it("routes the requested hostname to the requested service", async () => {
		const { service, update } = buildService([]);

		await run(service.configureIngress("p1", "tunnel-1", "node.example.com", "http://traefik:80"));

		expect(sentIngress(update)).toEqual([
			{ hostname: "node.example.com", service: "http://traefik:80" },
			{ service: "http_status:404" },
		]);
	});

	it("preserves other hostnames' rules on the same tunnel", async () => {
		const { service, update } = buildService([
			{ hostname: "other.example.com", service: "http://other:80" },
			{ service: "http_status:404" },
		]);

		await run(service.configureIngress("p1", "tunnel-1", "node.example.com", "http://traefik:80"));

		const ingress = sentIngress(update);
		expect(ingress).toContainEqual({ hostname: "other.example.com", service: "http://other:80" });
		// Exactly one terminator, at the end — never two.
		expect(ingress.filter((rule) => rule.hostname === undefined)).toHaveLength(1);
	});

	it("replaces this hostname's previous rule rather than duplicating it", async () => {
		const { service, update } = buildService([
			{ hostname: "node.example.com", service: "http://stale:80" },
			{ service: "http_status:404" },
		]);

		await run(service.configureIngress("p1", "tunnel-1", "node.example.com", "http://traefik:80"));

		const mine = sentIngress(update).filter((rule) => rule.hostname === "node.example.com");
		expect(mine).toEqual([{ hostname: "node.example.com", service: "http://traefik:80" }]);
	});

	it("is idempotent when applied twice", async () => {
		const first = await buildService([]);
		await run(first.service.configureIngress("p1", "tunnel-1", "node.example.com", "http://traefik:80"));
		const once = sentIngress(first.update);

		// Feed the first result back in, as a second run would find it.
		const second = await buildService(once);
		await run(second.service.configureIngress("p1", "tunnel-1", "node.example.com", "http://traefik:80"));

		expect(sentIngress(second.update)).toEqual(once);
	});

	it("surfaces a Cloudflare rejection as a BadGateway carrying the reason", async () => {
		const { service, update } = buildService([]);
		update.mockRejectedValue(new Error("Bad Configuration: Validation failed"));

		// Previously the SDK error escaped untranslated and the caller saw a bare
		// 500 with no reason attached.
		await expect(
			run(service.configureIngress("p1", "tunnel-1", "node.example.com", "http://traefik:80")),
		).rejects.toBeInstanceOf(BadGatewayException);

		await expect(
			run(service.configureIngress("p1", "tunnel-1", "node.example.com", "http://traefik:80")),
		).rejects.toThrow(/node\.example\.com/);
	});
});

/**
 * `createTunnel` — provisioning must survive a partial failure.
 *
 * Cloudflare enforces tunnel names per account (error 1013). A run that created
 * the tunnel and then failed later — a refused ingress, a crash before persisting
 * — leaves an orphan whose id we never stored, so the local "already has a
 * tunnelId" guard does not hold and the next attempt collides. Reusing by name is
 * what keeps that from wedging the node permanently.
 */
describe("CloudflareTunnelService.createTunnel idempotency", () => {
	function buildAppService(existingTunnel: { id: string; name: string } | null) {
		const create = vi.fn().mockResolvedValue({ id: "brand-new", name: "deployer-abc12345" });
		const client = {
			zeroTrust: {
				tunnels: {
					cloudflared: {
						list: vi.fn().mockResolvedValue({ result: existingTunnel ? [existingTunnel] : [] }),
						create,
						token: { get: vi.fn().mockResolvedValue("token-abc") },
					},
				},
			},
		};
		const appService = {
			getAppView: vi.fn(() =>
				Effect.succeed({
					isActive: true,
					name: "main",
					features: { dnsManagement: true, tunnelManagement: true },
				} satisfies Partial<DnsProviderAppView>),
			),
			buildClient: vi.fn(() => Effect.succeed(client)),
			getOrResolveAccountId: vi.fn(() => Effect.succeed("account-1")),
		};
		return { service: tunnelServiceOver(appService), create };
	}

	it("creates a tunnel when the name is free", async () => {
		const { service, create } = buildAppService(null);

		const result = await run(service.createTunnel("p1", { name: "deployer-abc12345" }));

		expect(create).toHaveBeenCalledTimes(1);
		expect(result.tunnel.id).toBe("brand-new");
	});

	it("reuses an existing tunnel of the same name instead of colliding", async () => {
		const { service, create } = buildAppService({ id: "orphan-1", name: "deployer-abc12345" });

		const result = await run(service.createTunnel("p1", { name: "deployer-abc12345" }));

		// The whole point: no second create, so Cloudflare cannot answer 1013.
		expect(create).not.toHaveBeenCalled();
		expect(result.tunnel.id).toBe("orphan-1");
		// The token is still fetched, so the caller can run a connector.
		expect(result.token).toBe("token-abc");
	});
});
