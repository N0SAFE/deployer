import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { DockerNotFound, type DockerEngineShape } from "@deployer/docker";

import { makeEdgeConnectorSupervisor, type DesiredEdgeConnector } from "./edge-connector-supervisor";

const connector: DesiredEdgeConnector = {
	providerId: "some-tunnel",
	spec: { image: "tunnel:1", env: ["TOKEN=secret"], command: ["tunnel"], args: ["run"], replicas: 2 },
};

type Spec = {
	name: string;
	image: string;
	env: string[];
	command: string[];
	args: string[];
	replicas: number;
	endpointPorts: unknown[];
	placementMaxReplicasPerNode: number;
	placementPreferences: unknown[];
	labels: Record<string, string>;
	networks: { aliases: string[] }[];
};

function setup(initial: DesiredEdgeConnector | null, options: { existing?: boolean; running?: number; desiredFails?: boolean; swarmActive?: boolean } = {}) {
	let desired = initial;
	const services = new Map<string, { ID: string; CreatedAt: string; UpdatedAt: string; Spec: { Name: string } }>();
	if (options.existing === true) services.set("deployer-edge-connector", { ID: "svc", CreatedAt: "c", UpdatedAt: "u", Spec: { Name: "deployer-edge-connector" } });
	const reconciled: Spec[] = [];
	const removed: string[] = [];

	const engine = {
		swarmCluster: { isActive: () => Effect.succeed(options.swarmActive ?? true) },
		networks: { ensureOverlay: () => Effect.void },
		swarmServices: {
			reconcile: (spec: Spec) =>
				Effect.sync(() => {
					reconciled.push(spec);
					services.set(spec.name, { ID: "svc", CreatedAt: "c", UpdatedAt: "u", Spec: { Name: spec.name } });
				}),
			inspect: (name: string) => {
				const found = services.get(name);
				return found === undefined ? Effect.fail(new DockerNotFound({ resource: name })) : Effect.succeed(found);
			},
			listTasks: () => Effect.succeed(Array.from({ length: options.running ?? 1 }, () => ({ Status: { State: "running" } }))),
			remove: (name: string) =>
				Effect.sync(() => {
					removed.push(name);
					services.delete(name);
				}),
		},
	} as unknown as DockerEngineShape;

	const logger = { log: vi.fn() };
	const edge = makeEdgeConnectorSupervisor({
		engine,
		logger,
		config: {
			prefix: () => "",
			desired: Effect.suspend(() => (options.desiredFails === true ? Effect.fail(new Error("provider down")) : Effect.succeed(desired))),
			routeTarget: () => "http://deployer-traefik:8002",
			runtimeOverride: () => undefined,
		},
	});
	return {
		edge,
		reconciled,
		removed,
		logger,
		setDesired: (next: DesiredEdgeConnector | null) => {
			desired = next;
		},
	};
}

const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);

describe("edge connector — convergence", () => {
	it("runs the provider's connector replicated, at most one per node, and publishes nothing", async () => {
		const { edge, reconciled } = setup(connector);
		await run(edge.spec.converge);
		expect(edge.runtime()).toBe("swarm-replicated");
		expect(reconciled[0]).toMatchObject({
			name: "deployer-edge-connector",
			image: "tunnel:1",
			env: ["TOKEN=secret"],
			command: ["tunnel"],
			args: ["run"],
			replicas: 2,
			placementMaxReplicasPerNode: 1,
			placementPreferences: [{ spreadDescriptor: "node.id" }],
			endpointPorts: [],
		});
		expect(reconciled[0]?.labels["deployer.edge.provider"]).toBe("some-tunnel");
		expect(reconciled[0]?.networks[0]?.aliases).toEqual(["deployer-edge-connector"]);
	});

	it("fails when the connector converged but nothing runs, after retrying", async () => {
		vi.useFakeTimers();
		try {
			const { edge } = setup(connector, { running: 0 });
			const done = run(edge.spec.converge).catch((error: unknown) => error);
			await vi.advanceTimersByTimeAsync(60_000);
			expect(await done).toMatchObject({ _tag: "SupervisedResourceNotRunning" });
		} finally {
			vi.useRealTimers();
		}
	});

	it("is `managed` with nothing to run, and removes a connector left from a previous edge", async () => {
		const { edge, removed, logger } = setup(null, { existing: true });
		await run(edge.spec.converge);
		expect(edge.runtime()).toBe("managed");
		expect(removed).toEqual(["deployer-edge-connector"]);
		expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("No tunnel edge any more"));
	});

	it("removes nothing when nothing is left over", async () => {
		const { edge, removed } = setup(null);
		await run(edge.spec.converge);
		expect(removed).toHaveLength(0);
	});

	it("follows the provider: a lane switch removes the connector on the next sweep", async () => {
		const { edge, removed, setDesired } = setup(connector);
		await run(edge.spec.converge);
		setDesired(null);
		await run(edge.spec.converge);
		expect(removed).toEqual(["deployer-edge-connector"]);
	});

	it("fails the pass, leaving what runs untouched, when the provider cannot be asked", async () => {
		const { edge, reconciled, removed } = setup(connector, { desiredFails: true });
		await expect(run(edge.spec.converge)).rejects.toThrow("provider down");
		expect(reconciled).toHaveLength(0);
		expect(removed).toHaveLength(0);
	});

	it("is deferred until a swarm exists when there is a connector to run, never when there is not", async () => {
		const running = setup(connector, { swarmActive: false });
		await run(running.edge.reload);
		expect(await run(running.edge.spec.blocker ?? Effect.succeed(null))).toContain("deferred until an active swarm");
		const idle = setup(null, { swarmActive: false });
		await run(idle.edge.reload);
		expect(await run(idle.edge.spec.blocker ?? Effect.succeed("x"))).toBeNull();
	});
});

describe("edge connector — probe and process info", () => {
	it("is healthy and idle when no tunnel edge needs a connector", async () => {
		const { edge } = setup(null);
		const probe = await run(edge.spec.probe);
		expect(probe).toMatchObject({ healthy: true, detail: "No tunnel edge needs a connector.", payload: { runtime: "managed", replicas: 0, provider: null } });
		expect(probe.payload.routeTarget).toBe("http://deployer-traefik:8002");
	});

	it("is healthy while a task runs and reports the replicas", async () => {
		const { edge } = setup(connector, { existing: true, running: 2 });
		await run(edge.reload);
		const probe = await run(edge.spec.probe);
		expect(probe).toMatchObject({ healthy: true, payload: { provider: "some-tunnel", replicas: 2, service: { exists: true } } });
	});

	it("is unhealthy with no running task, or when the service is gone", async () => {
		const idle = setup(connector, { existing: true, running: 0 });
		await run(idle.edge.reload);
		expect((await run(idle.edge.spec.probe)).detail).toContain("0 running task");
		const gone = setup(connector);
		await run(gone.edge.reload);
		expect(await run(gone.edge.spec.probe)).toMatchObject({ healthy: false, payload: { service: null } });
	});

	it("shows a zero-replica process when nothing runs, and the live service when one does", async () => {
		const idle = (await run(setup(null).edge.spec.processInfo)) as { process: { desired: { replicas: number } }; edge: { provider: null } };
		expect(idle.process.desired.replicas).toBe(0);
		expect(idle.edge.provider).toBeNull();

		const { edge } = setup(connector, { existing: true });
		await run(edge.reload);
		const live = (await run(edge.spec.processInfo)) as { process: { live: { exists: boolean } }; edge: { provider: string } };
		expect(live.process.live.exists).toBe(true);
		expect(live.edge.provider).toBe("some-tunnel");
	});
});
