import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
	PLATFORM_API_ROUTER_NAME,
	PLATFORM_API_SERVICE_NAME,
	PlatformRouteConfigService,
} from "./platform-route-config.service";

/** Typed accessor over the generated dynamic config. */
function yamlOf(raw: string): {
	http?: {
		routers?: Record<string, { rule?: string; service?: string; entryPoints?: string[] }>;
		services?: Record<string, { loadBalancer?: { servers?: { url: string }[] } }>;
	};
} {
	return YAML.parse(raw);
}

describe("PlatformRouteConfigService", () => {
	const svc = new PlatformRouteConfigService();

	it("routes the api hostname to the api backend through the web entrypoint", () => {
		const config = yamlOf(svc.buildApiYaml("http://api-dev:3005", "api.acme.deployer.localhost"));

		const router = config.http?.routers?.[PLATFORM_API_ROUTER_NAME];
		expect(router?.rule).toBe("Host(`api.acme.deployer.localhost`)");
		expect(router?.service).toBe(PLATFORM_API_SERVICE_NAME);
		expect(router?.entryPoints).toContain("web");

		const lb = config.http?.services?.[PLATFORM_API_SERVICE_NAME]?.loadBalancer;
		expect(lb?.servers).toEqual([{ url: "http://api-dev:3005" }]);
	});

	it("emits empty prefix grammar hostnames verbatim", () => {
		const config = yamlOf(svc.buildApiYaml("http://host.docker.internal:3005", "api.deployer.localhost"));
		expect(config.http?.routers?.[PLATFORM_API_ROUTER_NAME]?.rule).toBe("Host(`api.deployer.localhost`)");
	});

	it("produces parseable YAML with stable structure", () => {
		const raw = svc.buildApiYaml("http://x:1", "api.deployer.localhost");
		expect(raw).toMatch(/^http:/);
		expect(raw).toContain("routers:");
		expect(raw).toContain("services:");
	});

	it("builds one router+service per DB-driven domain route", () => {
		const raw = svc.buildDomainRoutesYaml([
			{ name: "deploy-deployer-sebille-net", hosts: ["deployer.sebille.net"], backendUrl: "http://api-dev:3005" },
			{
				name: "deploy-app-example-com",
				hosts: ["app.example.com", "www.example.com"],
				backendUrl: "http://preview-abc:3000",
			},
		]);

		const config = yamlOf(raw);
		expect(config.http?.routers?.["deploy-deployer-sebille-net"]?.rule).toBe("Host(`deployer.sebille.net`)");
		expect(config.http?.routers?.["deploy-deployer-sebille-net"]?.service).toBe("deploy-deployer-sebille-net-svc");
		expect(config.http?.services?.["deploy-deployer-sebille-net-svc"]?.loadBalancer?.servers).toEqual([
			{ url: "http://api-dev:3005" },
		]);

		// Multi-host route → OR rule; distinct service.
		const appRouter = config.http?.routers?.["deploy-app-example-com"];
		expect(appRouter?.rule).toBe("Host(`app.example.com`) || Host(`www.example.com`)");
		expect(config.http?.services?.["deploy-app-example-com-svc"]?.loadBalancer?.servers).toEqual([
			{ url: "http://preview-abc:3000" },
		]);
		// No collisions with the platform routers.
		expect(config.http?.routers?.[PLATFORM_API_ROUTER_NAME]).toBeUndefined();
	});
});
