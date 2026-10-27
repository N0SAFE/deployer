import type { DockerService } from "@deployer/nest-docker/services/docker.service";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { defaultIngressLanes, type IngressLanes } from "@deployer/contracts-entities/entities/ingress/index";

import type { EnvService } from "../../../../config/env/env.module";
import { TEST_TUNNEL_ID, testEdgeRegistry } from "../../edge/testing/edge-registry.fixture";
import { EnvHostnameService } from "../../platform-ingress/services/hostname.service";
import type { IngressLanesService } from "../../platform-ingress/services/ingress-lanes.service";
import type { PlatformConfigService } from "../../platform-ingress/services/platform-config.service";
import type { PlatformRoutesSource, SupervisedRoute } from "../../platform-ingress/services/platform-routes-source.service";
import type { PlatformWebTargetService } from "../../platform-ingress/services/platform-web-target.service";
import type { TraefikRepository } from "../repositories/traefik.repository";
import { TraefikIngressConfigService } from "./traefik-ingress-config.service";

async function makeService(options: { lanes?: IngressLanes; routes?: SupervisedRoute[]; setupFile?: string; webTarget?: string | null } = {}) {
	const dir = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "ingress-config-"));
	if (options.setupFile !== undefined) await writeFile(join(dir, "dynamic-setup.yml"), options.setupFile);
	const values: Record<string, unknown> = { DEPLOYER_PREFIX: "", API_PORT: 3005, DEPLOYER_API_TARGET: "deployer-api", TRAEFIK_CONFIG_BASE_PATH: dir };
	const env = { get: vi.fn((key: string) => values[key]) } as unknown as EnvService;
	return new TraefikIngressConfigService(
		env,
		// The service only calls `getDockerClient()` to hand the client onward; the tests never
                // touch a Docker API, so an empty client is asserted to the interface.
                { getDockerClient: () => ({}) } as unknown as DockerService,
		new EnvHostnameService(env),
		{ getLanes: () => Promise.resolve(options.lanes ?? defaultIngressLanes()) } as unknown as IngressLanesService,
		{ resolveWebTarget: () => Promise.resolve(options.webTarget === undefined ? "deployer-managed-web" : options.webTarget) } as unknown as PlatformWebTargetService,
		{ listSupervisedRoutes: () => Promise.resolve(options.routes ?? []) } as unknown as PlatformRoutesSource,
		{ getAllServiceConfigs: () => Promise.resolve([]), getServiceTargetsByConfigId: () => Promise.resolve([]) } as unknown as TraefikRepository,
		{ getManagedWebOrigin: () => Promise.resolve(null), getManagedWebTunnel: () => Promise.resolve(null) } as unknown as PlatformConfigService,
		testEdgeRegistry().registry,
	);
}

describe("TraefikIngressConfigService", () => {
	it("publishes the console on the local lane of a fresh install", async () => {
		const { http } = await (await makeService()).buildDynamicConfig();
		expect(http.routers["platform-api-local"]?.rule).toBe("Host(`api.deployer.localhost`)");
		expect(http.routers["platform-web-local"]?.rule).toBe("Host(`web.deployer.localhost`)");
		expect(http.services["platform-api-svc"]).toEqual({ loadBalancer: { servers: [{ url: "http://deployer-api:3005" }] } });
		expect(Object.keys(http.routers).every((name) => name.endsWith("-local"))).toBe(true);
	});

	it("falls back to the API's console when the web app is not running", async () => {
		const { http } = await (await makeService({ webTarget: null })).buildDynamicConfig();
		expect(http.routers["platform-web-local"]).toBeUndefined();
		expect(http.services["platform-web-console-svc"]?.loadBalancer.servers[0]?.url).toBe("http://deployer-api:3005");
	});

	it("routes deployments by label on every lane and by custom domain on the public one", async () => {
		const lanes: IngressLanes = { ...defaultIngressLanes(), public: { provider: TEST_TUNNEL_ID, domain: "apps.example.com", acknowledgedInboundPorts: false, options: { account: "acc" } } };
		const routes: SupervisedRoute[] = [
			{ name: "deploy-web-shop", label: "web-shop", hosts: ["shop.example.com"], visibility: "public", source: "deployment", target: { kind: "container", name: "shop-web-1", port: 3000 } },
		];
		const { http } = await (await makeService({ lanes, routes })).buildDynamicConfig();
		expect(http.routers["deploy-web-shop-local"]?.rule).toBe("Host(`web-shop.deployer.localhost`)");
		expect(http.routers["deploy-web-shop-public"]?.rule).toBe("(Host(`web-shop.apps.example.com`) || Host(`shop.example.com`))");
		expect(http.services["deploy-web-shop-svc"]?.loadBalancer.servers[0]?.url).toBe("http://shop-web-1:3000");
	});

	describe("the setup hostname", () => {
		it("stays with the wizard while setup's handover file still points at setup", async () => {
			const service = await makeService({ setupFile: 'services:\n  x:\n    loadBalancer:\n      servers:\n        - url: "http://setup:3016"\n' });
			expect(await service.setupRouteTarget("http://deployer-api:3005")).toEqual({ url: "http://setup:3016", servedBySetup: true });
			const { http } = await service.buildDynamicConfig();
			expect(http.routers["platform-setup-redirect-local"]).toBeUndefined();
		});

		it("belongs to the API, with the reload redirect, once setup points at the done page", async () => {
			const service = await makeService({ setupFile: '- url: "http://deployer-api:3005/setup/done"\n' });
			expect(await service.setupRouteTarget("http://deployer-api:3005")).toEqual({ url: "http://deployer-api:3005", servedBySetup: false });
			const { http } = await service.buildDynamicConfig();
			expect(http.routers["platform-setup-redirect-local"]).toMatchObject({ middlewares: ["platform-setup-redirect"], priority: 3100 });
			expect(http.middlewares?.["platform-setup-redirect"]).toBeDefined();
		});

		it("belongs to the API when setup never wrote a file", async () => {
			expect(await (await makeService()).setupRouteTarget("http://api:3005")).toEqual({ url: "http://api:3005", servedBySetup: false });
		});
	});
});
