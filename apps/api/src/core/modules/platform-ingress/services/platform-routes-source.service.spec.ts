import { describe, expect, it } from "vitest";
import {
	PlatformRoutesSource,
	hostnameOf,
	routeNameFromHost,
} from "./platform-routes-source.service";
import type { GlobalDatabase } from "@/core/modules/database/global/global-database.service";

/**
 * Fake drizzle client: every `select()` returns a thenable query chain that
 * resolves to the NEXT queued fixture group (the service calls the three
 * queries sequentially: node_network_config, deployments+services, previews).
 */
function fakeDb(groups: ReadonlyArray<ReadonlyArray<Record<string, unknown>>>): GlobalDatabase {
	const queue = [...groups.map((g) => [...g])];
	const chain = (rows: Record<string, unknown>[]): unknown => ({
		from: () => chain(rows),
		innerJoin: () => chain(rows),
		where: () => chain(rows),
		orderBy: () => chain(rows),
		limit: () => chain(rows),
		then: (onFulfilled: (value: Record<string, unknown>[]) => unknown) => Promise.resolve(rows).then(onFulfilled),
	});
	return {
		select: () => chain(queue.shift() ?? []),
	} as unknown as GlobalDatabase;
}

describe("PlatformRoutesSource", () => {
	it("publishes global hostname + tunnel rules that target the API", async () => {
		const db = fakeDb([
			[
				{
					publicAddress: "deployer.sebille.net",
					addressKind: "hostname",
					tunnelHostname: "tunnel.sebille.net",
				},
			],
			[],
			[],
		]);
		const source = new PlatformRoutesSource(db);

		const routes = await source.listSupervisedRoutes();

		expect(routes).toHaveLength(2);
		const global = routes[0];
		expect(global).toMatchObject({
			name: "deploy-deployer-sebille-net",
			hosts: ["deployer.sebille.net"],
			source: "global-hostname",
			target: { kind: "api" },
		});
		const tunnel = routes[1];
		expect(tunnel).toMatchObject({
			hosts: ["tunnel.sebille.net"],
			source: "tunnel",
			target: { kind: "api" },
		});
	});

	it("routes a public IP address to the API via Traefik (Host(<ip>) → api)", async () => {
		const db = fakeDb([
			[
				{
					publicAddress: "203.0.113.10",
					addressKind: "ip",
					tunnelHostname: "",
				},
			],
			[],
			[],
		]);
		const source = new PlatformRoutesSource(db);

		const routes = await source.listSupervisedRoutes();

		expect(routes).toHaveLength(1);
		expect(routes[0]).toMatchObject({
			hosts: ["203.0.113.10"],
			source: "global-hostname",
			target: { kind: "api" },
		});
	});

	it("routes successful deployments (domainUrl + customDomains) to their container:port", async () => {
		const db = fakeDb([
			[],
			[
				{
					deployment: {
						containerName: "myapp-web-abc",
						domainUrl: "https://app.example.com",
						status: "success",
						createdAt: new Date(),
					},
					service: { port: 3000, customDomains: ["alt.example.com"] },
				},
			],
			[],
		]);
		const source = new PlatformRoutesSource(db);

		const routes = await source.listSupervisedRoutes();

		expect(routes).toHaveLength(1);
		expect(routes[0]).toMatchObject({
			hosts: ["app.example.com", "alt.example.com"],
			source: "deployment",
			target: { kind: "container", name: "myapp-web-abc", port: 3000 },
		});
	});

	it("routes active previews to their preview deployment container", async () => {
		const db = fakeDb([
			[],
			[],
			[
				{
					preview: { fullDomain: "myapp-pr-123.preview.example.com" },
					deployment: { containerName: "myapp-pr-123" },
					service: { port: 3001 },
				},
			],
		]);
		const source = new PlatformRoutesSource(db);

		const routes = await source.listSupervisedRoutes();

		expect(routes).toHaveLength(1);
		expect(routes[0]).toMatchObject({
			hosts: ["myapp-pr-123.preview.example.com"],
			source: "preview",
			target: { kind: "container", name: "myapp-pr-123", port: 3001 },
		});
	});

	it("skips deployments without a container or port (no phantom routes)", async () => {
		const db = fakeDb([
			[],
			[
				{ deployment: { containerName: null, domainUrl: "https://x.com" }, service: { port: 3000, customDomains: [] } },
				{ deployment: { containerName: "has-container", domainUrl: "https://y.com" }, service: { port: null, customDomains: [] } },
			],
			[],
		]);
		const source = new PlatformRoutesSource(db);

		const routes = await source.listSupervisedRoutes();
		expect(routes).toEqual([]);
	});
});

describe("route helpers", () => {
	it("slugs hostnames into stable router keys without collisions with platform routers", () => {
		expect(routeNameFromHost("deployer.sebille.net")).toBe("deploy-deployer-sebille-net");
		expect(routeNameFromHost("App.Example.COM")).toBe("deploy-app-example-com");
		expect(routeNameFromHost("*.example.com")).toBe("deploy-wildcard-example-com");
	});

	it("extracts the hostname from origins or bare hosts", () => {
		expect(hostnameOf("deployer.sebille.net")).toBe("deployer.sebille.net");
		expect(hostnameOf("https://app.example.com/path")).toBe("app.example.com");
		expect(hostnameOf("  ")).toBeNull();
	});
});