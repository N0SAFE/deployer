import { describe, expect, it } from "vitest";
import { defaultIngressLanes, type IngressLanes } from "@repo/contracts-entities/entities/ingress/index";

import { buildNodeDoors } from "./ingress-doors";
import { deriveIngressProviderToken, ingressTokenMatches, requireIngressSecret } from "./ingress-provider-token";
import { buildLaneTraefikConfig, type LaneRoute } from "./lane-traefik-config";

const domains = { local: "deployer.localhost", private: "deployer.internal", public: "apps.example.com" };
const services = { "api-svc": "http://deployer-api:3005", "app-svc": "http://app:8080" };

const allLanes = (overrides: Partial<IngressLanes> = {}): IngressLanes => ({
	...defaultIngressLanes(),
	private: { enabled: true, domain: "deployer.internal", exposeOnLan: false },
	public: { provider: "some-tunnel", domain: "apps.example.com", acknowledgedInboundPorts: false, options: {} },
	...overrides,
});

const api: LaneRoute = { name: "platform-api", labels: ["api"], visibility: "public", service: "api-svc" };
const internalApp: LaneRoute = { name: "deploy-app", labels: ["app-shop"], publicHosts: ["shop.example.com"], visibility: "private", service: "app-svc" };

describe("buildLaneTraefikConfig", () => {
	it("gives each lane its own router, bound to that lane's entrypoint only", () => {
		const { http } = buildLaneTraefikConfig({ lanes: allLanes(), domains, routes: [api], services, tlsResolver: "letsencrypt", publicAcme: false });
		expect(http.routers).toEqual({
			"platform-api-local": { rule: "Host(`api.deployer.localhost`)", service: "api-svc", entryPoints: ["local"] },
			"platform-api-private": { rule: "Host(`api.deployer.internal`)", service: "api-svc", entryPoints: ["private"] },
			"platform-api-public": { rule: "Host(`api.apps.example.com`)", service: "api-svc", entryPoints: ["public"] },
		});
		expect(http.services).toEqual({ "api-svc": { loadBalancer: { servers: [{ url: "http://deployer-api:3005" }] } } });
	});

	it("keeps a PRIVATE route off the public lane — custom domains included", () => {
		const { http } = buildLaneTraefikConfig({ lanes: allLanes(), domains, routes: [internalApp], services, tlsResolver: "letsencrypt", publicAcme: false });
		expect(Object.keys(http.routers).sort()).toEqual(["deploy-app-local", "deploy-app-private"]);
		expect(JSON.stringify(http)).not.toContain("shop.example.com");
	});

	it("serves explicit public hosts on the public lane alongside the generated one", () => {
		const route: LaneRoute = { ...internalApp, visibility: "public" };
		const { http } = buildLaneTraefikConfig({ lanes: allLanes(), domains, routes: [route], services, tlsResolver: "letsencrypt", publicAcme: false });
		expect(http.routers["deploy-app-public"]?.rule).toBe("(Host(`app-shop.apps.example.com`) || Host(`shop.example.com`))");
	});

	it("emits only local routers on a fresh, local-only install", () => {
		const { http } = buildLaneTraefikConfig({ lanes: defaultIngressLanes(), domains, routes: [api, internalApp], services, tlsResolver: "letsencrypt", publicAcme: false });
		expect(Object.keys(http.routers).sort()).toEqual(["deploy-app-local", "platform-api-local"]);
	});

	it("serves the public lane on `public-tls` with the resolver when the edge asks for ACME", () => {
		const { http } = buildLaneTraefikConfig({ lanes: allLanes(), domains, routes: [api], services, tlsResolver: "letsencrypt", publicAcme: true });
		expect(http.routers["platform-api-public"]).toEqual({
			rule: "Host(`api.apps.example.com`)",
			service: "api-svc",
			entryPoints: ["public-tls"],
			tls: { certResolver: "letsencrypt" },
		});
	});

	it("carries path suffixes, middlewares and priorities onto every lane", () => {
		const console: LaneRoute = { ...api, name: "console", ruleSuffix: "&& PathPrefix(`/manage`)", middlewares: ["mw"], priority: 2000 };
		const { http } = buildLaneTraefikConfig({
			lanes: defaultIngressLanes(),
			domains,
			routes: [console],
			services,
			middlewares: { mw: { redirectRegex: { regex: "x", replacement: "y" } } },
			tlsResolver: "letsencrypt",
			publicAcme: false,
		});
		expect(http.routers["console-local"]).toEqual({
			rule: "Host(`api.deployer.localhost`) && PathPrefix(`/manage`)",
			service: "api-svc",
			entryPoints: ["local"],
			middlewares: ["mw"],
			priority: 2000,
		});
		expect(http.middlewares).toEqual({ mw: { redirectRegex: { regex: "x", replacement: "y" } } });
	});

	it("skips a route whose backend is unknown rather than emitting a dangling router", () => {
		const { http } = buildLaneTraefikConfig({ lanes: defaultIngressLanes(), domains, routes: [{ ...api, service: "missing" }], services, tlsResolver: "le", publicAcme: false });
		expect(http.routers).toEqual({});
	});
});

describe("buildNodeDoors", () => {
	it("always plans the local door and the private door only when the lane is on", () => {
		const base = { namePrefix: "deployer", network: "deployer-platform-overlay", image: "nginx:alpine", traefikService: "deployer-traefik", rescue: [] };
		expect(buildNodeDoors({ ...base, lanes: defaultIngressLanes() }).lanes).toEqual({ local: { upstreamPort: 80 }, private: null, lan: null });
		expect(buildNodeDoors({ ...base, lanes: allLanes() }).lanes).toEqual({
			local: { upstreamPort: 80 },
			private: { upstreamPort: 8001 },
			lan: null,
		});
	});

	it("adds the LAN door only when the operator allows same-network joins", () => {
		const base = { namePrefix: "deployer", network: "deployer-platform-overlay", image: "nginx:alpine", traefikService: "deployer-traefik", rescue: [] };
		const onLan = { ...defaultIngressLanes(), private: { enabled: true, domain: "deployer.internal", exposeOnLan: true } };
		expect(buildNodeDoors({ ...base, lanes: onLan }).lanes.lan).toEqual({ upstreamPort: 8001 });
		// The private door binds the mesh address, which a joiner does not have yet —
		// so the LAN door is the only one that can serve a pre-membership node.
		expect(buildNodeDoors({ ...base, lanes: onLan }).lanes.private).toEqual({ upstreamPort: 8001 });
	});
});

describe("ingress provider token", () => {
	it("is derived, stable, and compared in constant time", () => {
		const token = deriveIngressProviderToken("s3cret");
		expect(token).toBe(deriveIngressProviderToken("s3cret"));
		expect(token).not.toBe(deriveIngressProviderToken("other"));
		expect(ingressTokenMatches(token, "s3cret")).toBe(true);
		expect(ingressTokenMatches(`${token}x`, "s3cret")).toBe(false);
		expect(ingressTokenMatches(undefined, "s3cret")).toBe(false);
	});

	it("refuses to derive a token from no secret at all", () => {
		expect(() => requireIngressSecret(undefined, "  ")).toThrow(/AUTH_SECRET/);
		expect(requireIngressSecret(undefined, "fallback")).toBe("fallback");
	});
});
