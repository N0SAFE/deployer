import { afterEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import { TraefikPlatformConfigService } from "./traefik-platform-config.service";
import { PlatformRouteConfigService } from "../../platform-ingress/services/platform-route-config.service";
import { EnvHostnameService } from "../../platform-ingress/services/hostname.service";
import type { PlatformWebTargetService } from "../../platform-ingress/services/platform-web-target.service";
import type { PlatformRoutesSource } from "../../platform-ingress/services/platform-routes-source.service";
import type { TraefikRepository } from "../repositories/traefik.repository";
import type { PlatformConfigService } from "../../platform-ingress/services/platform-config.service";
import type { DockerService } from "@/core/modules/docker/services/docker.service";
import type { EnvService } from "@/config/env/env.service";

async function makeConfigDir(): Promise<string> {
	const base = process.env.TMPDIR ?? "/tmp";
	return await mkdtemp(join(base, "traefik-platform-config-"));
}

function makeEnv(configDir: string): EnvService {
	const values: Record<string, unknown> = {
		DEPLOYER_PREFIX: "",
		API_PORT: 3005,
		MANAGED_WEB_APP_EXTERNAL: true,
		MANAGED_WEB_APP_ENABLED: false,
		TRAEFIK_CONFIG_BASE_PATH: configDir,
	};
	return { get: vi.fn((key: string) => values[key]) } as unknown as EnvService;
}

function makeDocker(): DockerService {
	return {
		getDockerClient: () => ({
			getContainer: vi.fn((name: string) => ({
				inspect: vi.fn(async () => ({ Id: name, Name: "/deployer-api" })),
			})),
		}),
	} as unknown as DockerService;
}

async function makeService(opts: { routes?: unknown[]; repo?: unknown[] } = {}) {
	const configDir = await makeConfigDir();
	const env = makeEnv(configDir);
	const dockerService = makeDocker();
	const hostnameService = new EnvHostnameService(env);
	const webTarget = {
		resolveWebTarget: vi.fn(async () => "web-dev"),
	} as unknown as PlatformWebTargetService;
	const routesSource = {
		listSupervisedRoutes: vi.fn(async () => opts.routes ?? []),
	} as unknown as PlatformRoutesSource;
	const repo = {
		getAllServiceConfigs: vi.fn(async () => opts.repo ?? []),
		getServiceTargetsByConfigId: vi.fn(async () => []),
	} as unknown as TraefikRepository;

	const service = new TraefikPlatformConfigService(
		env,
		dockerService,
		hostnameService,
		new PlatformRouteConfigService(),
		webTarget,
		routesSource,
		repo,
		{
			isManagedWebAppEnabled: vi.fn(async () => false),
			getManagedWebOrigin: vi.fn(async () => null),
			getManagedWebTunnel: vi.fn(async () => null),
		} as unknown as PlatformConfigService,
	);
	return { service, configDir, env, webTarget, routesSource, repo };
}

afterEach(() => {
	delete process.env.HOSTNAME;
});

describe("TraefikPlatformConfigService (core-module config handler)", () => {
	it("writes api + web + DB-domain + per-service configs (one file per owner)", async () => {
		process.env.HOSTNAME = "0123456789ab";
		const { service, configDir, repo } = await makeService({
			routes: [
				{
					name: "deploy-deployer-sebille-net",
					hosts: ["deployer.sebille.net"],
					source: "global-hostname",
					target: { kind: "api" },
				},
			],
			repo: [
				{ id: "cfg-12345678", fullDomain: "shop.example.com", port: 3000 },
			],
		});
		repo.getServiceTargetsByConfigId = vi.fn(async () => [
			{ url: "http://shop-web:3000", isActive: true },
		]) as unknown as TraefikRepository["getServiceTargetsByConfigId"];

		await service.writePlatformConfigs();

		const apiYaml = await readFile(join(configDir, "dynamic-api.yml"), "utf8");
		expect(apiYaml).toContain("Host(`api.deployer.localhost`)");
		// The api target resolves to the canonical container name (docker mock).
		expect(apiYaml).toContain("http://deployer-api:3005");

		const webYaml = await readFile(join(configDir, "dynamic-web.yml"), "utf8");
		expect(webYaml).toContain("Host(`web.deployer.localhost`)");
		expect(webYaml).toContain("http://web-dev:3000");

		const domainYaml = await readFile(join(configDir, "dynamic-domain.yml"), "utf8");
		expect(domainYaml).toContain("Host(`deployer.sebille.net`)");

		const servicesYaml = await readFile(join(configDir, "dynamic-services.yml"), "utf8");
		expect(servicesYaml).toContain("Host(`shop.example.com`)");
		expect(servicesYaml).toContain("http://shop-web:3000");
	});

	it("keeps the web file as a console-only FALLBACK when the web is stopped", async () => {
		process.env.HOSTNAME = "0123456789ab";
		const { service, configDir, webTarget } = await makeService({ repo: [] });
		webTarget.resolveWebTarget = vi.fn(async () => null) as unknown as PlatformWebTargetService["resolveWebTarget"];

		await service.writePlatformConfigs();

		// The web router is gone (web not running)…
		const webYaml = await readFile(join(configDir, "dynamic-web.yml"), "utf8");
		expect(webYaml).not.toContain("platform-web:");
		expect(webYaml).not.toContain("http://web-dev:3000");
		// …but the single console URL stays alive: `/manage/web-app` on the
		// platform hosts resolves to the API HTML console (api backend),
		// so one URL serves the other visual when the web app is stopped.
		expect(webYaml).toContain("platform-web-console:");
		expect(webYaml).toContain("PathPrefix(`/manage/web-app`)");
		expect(webYaml).toContain("http://deployer-api:3005");
		await expect(readFile(join(configDir, "dynamic-domain.yml"), "utf8")).rejects.toThrow();
		await expect(readFile(join(configDir, "dynamic-services.yml"), "utf8")).rejects.toThrow();
		// api always exists.
		await expect(readFile(join(configDir, "dynamic-api.yml"), "utf8")).resolves.toContain("Host(`");
	});

	it("publishes the console route to the web backend when the web is running (single URL, beautiful visual)", async () => {
		process.env.HOSTNAME = "0123456789ab";
		const { service, configDir } = await makeService({ repo: [] });

		await service.writePlatformConfigs();

		const webYaml = await readFile(join(configDir, "dynamic-web.yml"), "utf8");
		// Web router unchanged…
		expect(webYaml).toContain("Host(`web.deployer.localhost`)");
		expect(webYaml).toContain("http://web-dev:3000");
		// …and the console rule routes `/manage/web-app` (api + web hosts)
		// to the WEB backend — the beautiful page.
		expect(webYaml).toContain("platform-web-console:");
		expect(webYaml).toContain("priority: 2000");
		expect(webYaml).toContain("Host(`api.deployer.localhost`) || Host(`web.deployer.localhost`)");
		expect(webYaml).toContain("PathPrefix(`/manage/web-app`)");
		expect(webYaml).toContain("http://web-dev:3000");
	});

	it("survives a failing DB (per-service family skipped, platform files still written)", async () => {
		process.env.HOSTNAME = "0123456789ab";
		const { service, configDir, repo } = await makeService({});
		repo.getAllServiceConfigs = vi.fn(async () => {
			throw new Error("table does not exist yet");
		}) as unknown as TraefikRepository["getAllServiceConfigs"];

		const spy = vi.spyOn(service["logger"], "log");
		await service.writePlatformConfigs();

		await expect(readFile(join(configDir, "dynamic-api.yml"), "utf8")).resolves.toContain("Host(`");
		await expect(readFile(join(configDir, "dynamic-services.yml"), "utf8")).rejects.toThrow();
		expect(spy).toHaveBeenCalled();
	});

	it("publishes api + web during FIRST BOOT when the global DB is absent (setup phase)", async () => {
		// First boot: no database yet (routesSource query rejects exactly like
		// a missing global Postgres) — the domain family must be SKIPPED, not
		// fatal, so api.<host> / web.<host> are reachable while setup runs.
		process.env.HOSTNAME = "0123456789ab";
		const { service, configDir, routesSource } = await makeService({});
		routesSource.listSupervisedRoutes = vi.fn(async () => {
			throw new Error('relation "deployments" does not exist');
		}) as unknown as PlatformRoutesSource["listSupervisedRoutes"];

		await service.writePlatformConfigs();

		await expect(readFile(join(configDir, "dynamic-api.yml"), "utf8")).resolves.toContain("Host(`api.deployer.localhost`)");
		await expect(readFile(join(configDir, "dynamic-web.yml"), "utf8")).resolves.toContain("Host(`web.deployer.localhost`)");
		await expect(readFile(join(configDir, "dynamic-web.yml"), "utf8")).resolves.toContain("http://web-dev:3000");
		// The DB-driven domain file is removed (no stale rules).
		await expect(readFile(join(configDir, "dynamic-domain.yml"), "utf8")).rejects.toThrow();
	});

	it("single-publishes deployment hosts — per-service file skips hosts the domain file claims", async () => {
		process.env.HOSTNAME = "0123456789ab";
		const { service, configDir, repo } = await makeService({
			routes: [
				{
					name: "deploy-my-deployment",
					hosts: ["app.example.com"],
					source: "deployment",
					target: { kind: "container", name: "deploy-app-1", port: 8080 },
				},
			],
			repo: [
				// Same host written by the domain-registration flow — MUST be skipped.
				{ id: "cfg-88888888", fullDomain: "app.example.com", port: 8080 },
				// Distinct host — still published by the per-service file.
				{ id: "cfg-99999999", fullDomain: "shop.example.com", port: 3000 },
			],
		});
		repo.getServiceTargetsByConfigId = vi.fn(async () => [
			{ url: "http://deploy-app-1:8080", isActive: true },
		]) as unknown as TraefikRepository["getServiceTargetsByConfigId"];

		await service.writePlatformConfigs();

		const domainYaml = await readFile(join(configDir, "dynamic-domain.yml"), "utf8");
		expect(domainYaml).toContain("Host(`app.example.com`)");

		const servicesYaml = await readFile(join(configDir, "dynamic-services.yml"), "utf8");
		// Claimed host: NOT in the per-service file.
		expect(servicesYaml).not.toContain("Host(`app.example.com`)");
		// Unclaimed host: present.
		expect(servicesYaml).toContain("Host(`shop.example.com`)");
	});
});