import { describe, expect, it } from "vitest";
import {
	PlatformRoutesSource,
	dedupeRoutes,
	dnsLabel,
	hostnameOf,
	routeNameFromHost,
	type SupervisedRoute,
} from "./platform-routes-source.service";
import type { GlobalDatabase } from "../../database/global/global-database.service";

/**
 * Fake drizzle client: every `select()` returns a thenable query chain that
 * resolves to the NEXT queued fixture group (the service calls the three
 * queries sequentially: node_network_config, deployments+services, previews).
 */
function fakeDb(groups: readonly (readonly Record<string, unknown>[])[]): GlobalDatabase {
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
	it("publishes the node's global hostname as a rule that targets the API", async () => {
		const db = fakeDb([
			[
				{
					publicAddress: "deployer.sebille.net",
					addressKind: "hostname",
					// A per-node tunnel hostname is NO LONGER read: the tunnel
					// belongs to the stack and routes through one wildcard rule
					// (see Network → Ingress & edge), so a node publishes only its address.
					tunnelHostname: "tunnel.sebille.net",
				},
			],
			[],
			[],
		]);
		const source = new PlatformRoutesSource(db);

		const routes = await source.listSupervisedRoutes();

		expect(routes).toHaveLength(1);
		const global = routes[0];
		expect(global).toMatchObject({
			name: "deploy-deployer-sebille-net",
			hosts: ["deployer.sebille.net"],
			source: "global-hostname",
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

	it("routes successful deployments to their container:port, labelled <service>-<project>", async () => {
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
					service: { name: "web", port: 3000, customDomains: ["alt.example.com"], network: { visibility: "private" } },
					project: { name: "My App" },
				},
			],
			[],
		]);
		const source = new PlatformRoutesSource(db);

		const routes = await source.listSupervisedRoutes();

		expect(routes).toHaveLength(1);
		expect(routes[0]).toMatchObject({
			label: "web-my-app",
			hosts: ["app.example.com", "alt.example.com"],
			visibility: "private",
			source: "deployment",
			target: { kind: "container", name: "myapp-web-abc", port: 3000 },
		});
	});

	it("routes a deployment with NO domain on the generated lanes (label only, public by default)", async () => {
		const db = fakeDb([
			[],
			[
				{
					deployment: { containerName: "api-1", domainUrl: null },
					service: { name: "api", port: 8080, customDomains: [], network: null },
					project: { name: "shop" },
				},
			],
			[],
		]);
		const routes = await new PlatformRoutesSource(db).listSupervisedRoutes();
		expect(routes[0]).toMatchObject({ label: "api-shop", hosts: [], visibility: "public" });
	});

	it("routes active previews to their preview deployment container", async () => {
		const db = fakeDb([
			[],
			[],
			[
				{
					preview: { fullDomain: "myapp-pr-123.preview.example.com" },
					deployment: { containerName: "myapp-pr-123" },
					service: { port: 3001, network: null },
				},
			],
		]);
		const source = new PlatformRoutesSource(db);

		const routes = await source.listSupervisedRoutes();

		expect(routes).toHaveLength(1);
		expect(routes[0]).toMatchObject({
			label: "myapp-pr-123",
			hosts: ["myapp-pr-123.preview.example.com"],
			source: "preview",
			target: { kind: "container", name: "myapp-pr-123", port: 3001 },
		});
	});

	it("skips deployments without a container or port (no phantom routes)", async () => {
		const db = fakeDb([
			[],
			[
				{ deployment: { containerName: null, domainUrl: "https://x.com" }, service: { name: "a", port: 3000, customDomains: [] }, project: { name: "p" } },
				{ deployment: { containerName: "has-container", domainUrl: "https://y.com" }, service: { name: "b", port: null, customDomains: [] }, project: { name: "p" } },
			],
			[],
		]);
		const source = new PlatformRoutesSource(db);

		const routes = await source.listSupervisedRoutes();
		expect(routes).toEqual([]);
	});
});

describe("dedupeRoutes", () => {
	const route = (name: string, label: string | null, hosts: string[]): SupervisedRoute => ({
		name,
		label,
		hosts,
		visibility: "public",
		source: "deployment",
		target: { kind: "container", name, port: 80 },
	});

	it("never lets an older deployment take a label back from the newer one", () => {
		const newer = route("deploy-web-shop", "web-shop", []);
		const older = route("deploy-web-shop-old", "web-shop", ["legacy.example.com"]);
		expect(dedupeRoutes([newer, older])).toEqual([newer, { ...older, label: null }]);
	});

	it("drops a route left with nothing to claim", () => {
		const first = route("a", "x", ["h.example.com"]);
		expect(dedupeRoutes([first, route("b", "x", ["h.example.com"])])).toEqual([first]);
	});
});

describe("route helpers", () => {
	it("builds DNS labels that every lane domain accepts", () => {
		expect(dnsLabel("Web", "My App")).toBe("web-my-app");
		expect(dnsLabel("--")).toBe("app");
		expect(dnsLabel("a".repeat(80)).length).toBeLessThanOrEqual(63);
	});

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