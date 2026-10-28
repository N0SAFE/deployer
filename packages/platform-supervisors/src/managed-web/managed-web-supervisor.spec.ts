import { createServer, type Server } from "node:http";


import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DockerNotFound, type DockerEngineShape } from "@deployer/docker";

import { makeManagedWebSupervisor, type ManagedWebConfig } from "./managed-web-supervisor";
import { probeRoute } from "./route-probe";

import type { AddressInfo } from "node:net";

const servers: Server[] = [];
afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

/** A stand-in ingress answering `status` (and `contentType`) for every request; reports the Host it saw. */
async function ingress(status: number, contentType = "text/html") {
	const hosts: string[] = [];
	const server = createServer((request, response) => {
		hosts.push(String(request.headers.host));
		response.writeHead(status, { "content-type": contentType });
		response.end("x");
	});
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return { port: (server.address() as AddressInfo).port, hosts };
}

type Setup = {
	flag?: boolean;
	external?: boolean;
	swarmActive?: boolean;
	tasks?: { Status: { State: string } }[];
	existing?: boolean;
	mintFailures?: number;
	prefix?: string;
	ingressPort?: number;
};

function setup(options: Setup = {}) {
	const services = new Map<string, { ID: string; CreatedAt: string; UpdatedAt: string; Spec: { Name: string } }>();
	if (options.existing === true) services.set("deployer-managed-web", { ID: "svc-1", CreatedAt: "c", UpdatedAt: "u", Spec: { Name: "deployer-managed-web" } });
	const reconciled: { env: string[]; networks: unknown }[] = [];
	const removed: string[] = [];
	let mintFailures = options.mintFailures ?? 0;
	const mint = vi.fn(() =>
		mintFailures-- > 0 ? Effect.fail(new Error("db down")) : Effect.succeed({ appToken: `tok-${String(mint.mock.calls.length)}` }),
	);
	const revoke = vi.fn(() => Effect.void);

	const engine = {
		swarmCluster: { isActive: () => Effect.succeed(options.swarmActive ?? true) },
		networks: { ensureOverlay: () => Effect.void },
		swarmServices: {
			reconcile: (spec: { name: string; env: string[]; networks: unknown }) =>
				Effect.sync(() => {
					reconciled.push(spec);
					services.set(spec.name, { ID: "svc-1", CreatedAt: "c", UpdatedAt: "u", Spec: { Name: spec.name } });
				}),
			inspect: (name: string) => {
				const found = services.get(name);
				return found === undefined ? Effect.fail(new DockerNotFound({ resource: name })) : Effect.succeed(found);
			},
			listTasks: () => Effect.succeed(options.tasks ?? []),
			remove: (name: string) =>
				Effect.sync(() => {
					removed.push(name);
					services.delete(name);
				}),
		},
	} as unknown as DockerEngineShape;

	const config: ManagedWebConfig = {
		serviceName: () => "deployer-managed-web",
		prefix: () => options.prefix ?? "",
		image: () => undefined,
		authSecret: () => "s3",
		apiPort: () => 3005,
		ingressHost: () => "127.0.0.1",
		...(options.ingressPort === undefined ? {} : { ingressPort: () => options.ingressPort ?? 80 }),
		runtimeOverride: () => undefined,
		external: () => options.external ?? false,
		hostnames: { webHostname: () => "web.deployer.localhost", webOrigin: () => "http://web.deployer.localhost", apiOrigin: () => "http://api.deployer.localhost" },
		flagEnabled: Effect.succeed(options.flag ?? true),
		appInstances: { mint, revokeManaged: Effect.suspend(revoke) },
	};
	return { managedWeb: makeManagedWebSupervisor({ engine, config }), reconciled, removed, mint, revoke };
}

const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);

describe("managed web — convergence", () => {
	it("starts one replicated console with the env the web schema requires", async () => {
		const { managedWeb, reconciled } = setup();
		await run(managedWeb.spec.converge);
		const env = reconciled[0]?.env ?? [];
		expect(env).toEqual(
			expect.arrayContaining([
				"API_URL=http://deployer-api:3005",
				"NEXT_PUBLIC_API_URL=http://api.deployer.localhost",
				"NEXT_PUBLIC_APP_URL=http://web.deployer.localhost",
				"AUTH_SECRET=s3",
				"BETTER_AUTH_SECRET=s3",
			]),
		);
		expect(env.some((entry) => entry.startsWith("APP_INSTANCE_TOKEN="))).toBe(true);
		expect(reconciled[0]?.networks).toEqual([{ target: "deployer-platform-overlay", aliases: ["deployer-managed-web"] }]);
	});

	it("derives the private API address from the prefix, and passes the minted token under the name the web reads", async () => {
		const { managedWeb, reconciled } = setup({ prefix: "acme" });
		await run(managedWeb.spec.converge);
		expect(reconciled[0]?.env).toContain("API_URL=http://deployer-api-acme:3005");
		expect(reconciled[0]?.env).toContain("APP_INSTANCE_TOKEN=tok-1");
	});

	it("mints the instance token once, so a sweep leaves the spec unchanged", async () => {
		const { managedWeb, reconciled, mint } = setup();
		await run(managedWeb.spec.converge);
		await run(managedWeb.spec.converge);
		expect(mint).toHaveBeenCalledTimes(1);
		expect(reconciled[0]?.env).toEqual(reconciled[1]?.env);
	});

	it("retries a failed mint on the next pass instead of caching the failure", async () => {
		vi.useFakeTimers();
		try {
			const { managedWeb, mint } = setup({ mintFailures: 1 });
			const done = run(managedWeb.spec.converge);
			await vi.advanceTimersByTimeAsync(2_500);
			await done;
			expect(mint).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("removes the console and revokes its instance when the flag is off", async () => {
		const { managedWeb, removed, revoke, reconciled } = setup({ flag: false, existing: true });
		await run(managedWeb.spec.converge);
		expect(removed).toEqual(["deployer-managed-web"]);
		expect(revoke).toHaveBeenCalledOnce();
		expect(reconciled).toHaveLength(0);
	});

	it("treats an externally running web as 'removed'", async () => {
		const { managedWeb, removed } = setup({ external: true });
		await run(managedWeb.spec.converge);
		expect(removed).toEqual(["deployer-managed-web"]);
	});

	it("fails with a typed error when there is no swarm and the flag is on", async () => {
		const { managedWeb } = setup({ swarmActive: false });
		await expect(run(managedWeb.spec.converge)).rejects.toMatchObject({ _tag: "SupervisedResourceUnavailable" });
	});

	it("is deferred until a swarm exists", async () => {
		const { managedWeb } = setup({ swarmActive: false });
		expect(await run(managedWeb.spec.blocker ?? Effect.succeed(null))).toContain("deferred until an active swarm");
	});
});

describe("managed web — probe", () => {
	it("is healthy and idle when disabled by the flag", async () => {
		const probe = await run(setup({ flag: false }).managedWeb.spec.probe);
		expect(probe).toMatchObject({ healthy: true, detail: "managed web disabled by flag", payload: { desired: "disabled", service: null } });
	});

	it("is unhealthy when the flag is on and the service is missing, or has no running task", async () => {
		expect((await run(setup().managedWeb.spec.probe)).detail).toBe("service missing while flag enabled");
		const idle = await run(setup({ existing: true, tasks: [] }).managedWeb.spec.probe);
		expect(idle).toMatchObject({ healthy: false, detail: "service has no running task" });
	});

	it("is healthy with a running task even when the route is not published, and warns instead", async () => {
		const noRouter = await ingress(404, "text/plain");
		const { managedWeb } = setup({ existing: true, tasks: [{ Status: { State: "running" } }], ingressPort: noRouter.port });
		const probe = await run(managedWeb.spec.probe);
		expect(probe.healthy).toBe(true);
		expect(managedWeb.spec.warnings?.(probe, "converged", null)).toEqual([
			expect.stringContaining("the ingress has no router for web.deployer.localhost"),
		]);
		expect(noRouter.hosts).toEqual(["web.deployer.localhost"]);
	});

	it("reports no warning once the route answers", async () => {
		const routed = await ingress(200);
		const { managedWeb } = setup({ existing: true, tasks: [{ Status: { State: "running" } }], ingressPort: routed.port });
		const probe = await run(managedWeb.spec.probe);
		expect(managedWeb.spec.warnings?.(probe, "converged", null)).toEqual([]);
	});
});

describe("probeRoute", () => {
	const target = (port: number, timeoutMs = 500) => ({ ingressHost: "127.0.0.1", ingressPort: port, hostname: "web.test", path: "/h", timeoutMs });

	it("tells a missing router (plain-text 404) from an app 404 (HTML)", async () => {
		expect((await run(probeRoute(target((await ingress(404, "text/plain")).port)))).routed).toBe(false);
		expect((await run(probeRoute(target((await ingress(404, "text/html")).port)))).routed).toBe(true);
	});

	it("reports a 5xx as not serving", async () => {
		const observation = await run(probeRoute(target((await ingress(503)).port)));
		expect(observation).toMatchObject({ routed: false });
		expect(observation.reason).toContain("answered 503");
	});

	it("reports an unreachable ingress and a silent one without failing", async () => {
		const closed = await ingress(200);
		await new Promise((resolve) => servers.pop()?.close(resolve));
		expect((await run(probeRoute(target(closed.port)))).reason).toContain("is not reachable");

		const silent = createServer(() => undefined);
		servers.push(silent);
		await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
		const observation = await run(probeRoute(target((silent.address() as AddressInfo).port, 50)));
		expect(observation.reason).toContain("did not answer within 50ms");
	});
});
