import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { DoorConverger } from "./door-converger";
import { type ContainerSummary, DockerEngine, type DockerEngineShape, DockerEngineError } from "./docker-engine";
import { DOOR_HASH_LABEL, DOOR_LABEL, type NodeDoorsSetting } from "./doors.types";

const setting: NodeDoorsSetting = {
	image: "nginx:alpine",
	network: "deployer-platform-overlay",
	namePrefix: "deployer",
	entryPort: 80,
	upstream: "deployer-traefik",
	lanes: { local: { upstreamPort: 8000 }, private: { upstreamPort: 8001 }, lan: null },
	rescue: [{ host: "api.deployer.localhost", target: "deployer-api", port: 3005 }],
};

type MutableContainer = { -readonly [K in keyof ContainerSummary]: ContainerSummary[K] };

/** An in-memory engine: the port is a value, so no socket, no docker, no process. */
function memoryEngine() {
	const containers = new Map<string, MutableContainer>();
	const state = { network: true, portHolder: null as string | null, failStart: null as string | null };
	const counts = { created: 0, removed: 0 };

	const engine: DockerEngineShape = {
		inspectContainer: (name) => Effect.succeed(containers.get(name) ?? null),
		createContainer: (name, spec) =>
			Effect.sync(() => {
				counts.created += 1;
				containers.set(name, {
					id: name,
					running: false,
					labels: (spec.Labels ?? {}) as Record<string, string>,
					networks: [String((spec.HostConfig as { NetworkMode?: string }).NetworkMode)],
					publishedPorts: ["80/tcp"],
				});
				return name;
			}),
		startContainer: (id) => {
			if (state.failStart !== null) return Effect.fail(new DockerEngineError({ status: 500, message: state.failStart }));
			return Effect.sync(() => {
				const container = containers.get(id);
				if (container !== undefined) container.running = true;
			});
		},
		removeContainer: (id) =>
			Effect.sync(() => {
				counts.removed += 1;
				containers.delete(id);
			}),
		imageExists: () => Effect.succeed(true),
		pullImage: () => Effect.void,
		networkExists: () => Effect.succeed(state.network),
		findPortHolder: () => Effect.succeed(state.portHolder),
	};

	return { engine, containers, state, counts };
}

const converge = (engine: DockerEngineShape, plan: NodeDoorsSetting | null, mesh: string | null, lan: string | null) =>
	Effect.runPromise(new DoorConverger.live().converge(plan, mesh, lan).pipe(Effect.provideService(DockerEngine, engine)));

describe("DoorConverger", () => {
	it("does nothing before the API published a plan", async () => {
		const fake = memoryEngine();

		expect(await converge(fake.engine, null, "100.88.4.2", null)).toEqual([]);
		expect(fake.counts.created).toBe(0);
	});

	it("creates the planned doors", async () => {
		const fake = memoryEngine();

		const views = await converge(fake.engine, setting, "100.88.4.2", null);

		expect(views).toEqual([
			{ lane: "local", container: "deployer-door-local", bindAddress: "127.0.0.1", port: 80, state: "running", detail: null },
			{ lane: "private", container: "deployer-door-private", bindAddress: "100.88.4.2", port: 80, state: "running", detail: null },
		]);
		expect(fake.counts.created).toBe(2);
	});

	it("leaves an intact door alone, and only starts it when it is stopped", async () => {
		const fake = memoryEngine();
		await converge(fake.engine, setting, "100.88.4.2", null);

		await converge(fake.engine, setting, "100.88.4.2", null);
		expect(fake.counts).toEqual({ created: 2, removed: 0 });

		const door = fake.containers.get("deployer-door-local");
		if (door === undefined) throw new Error("door missing");
		door.running = false;

		const views = await converge(fake.engine, setting, "100.88.4.2", null);

		expect(views[0]?.state).toBe("running");
		expect(fake.containers.get("deployer-door-local")?.running).toBe(true);
		expect(fake.counts).toEqual({ created: 2, removed: 0 });
	});

	it("recreates a door whose hash matches but that lost its network and published port", async () => {
		const fake = memoryEngine();
		await converge(fake.engine, setting, "100.88.4.2", null);

		const door = fake.containers.get("deployer-door-local");
		if (door === undefined) throw new Error("door missing");
		door.networks = [];
		door.publishedPorts = [];

		await converge(fake.engine, setting, "100.88.4.2", null);

		expect(fake.counts.created).toBe(3);
		expect(fake.containers.get("deployer-door-local")?.publishedPorts).toEqual(["80/tcp"]);
	});

	it("waits instead of starting onto a port another container holds", async () => {
		const fake = memoryEngine();
		fake.state.portHolder = "deployer-traefik";

		const held = await converge(fake.engine, setting, "100.88.4.2", null);

		expect(held.map((view) => view.state)).toEqual(["absent", "absent"]);
		expect(held[0]?.detail).toContain("deployer-traefik");
		expect(fake.counts.created).toBe(0);

		fake.state.portHolder = null;
		const released = await converge(fake.engine, setting, "100.88.4.2", null);

		expect(released.map((view) => view.state)).toEqual(["running", "running"]);
		expect(fake.counts.created).toBe(2);
	});

	it("reports a foreign container squatting a door name and never removes it", async () => {
		const fake = memoryEngine();
		fake.containers.set("deployer-door-local", { id: "x", running: true, labels: {}, networks: [], publishedPorts: [] });

		const [local] = await converge(fake.engine, setting, null, null);

		expect(local?.state).toBe("failed");
		expect(local?.detail).toContain("is not a door");
		expect(fake.containers.get("deployer-door-local")?.id).toBe("x");
		expect(fake.counts.removed).toBe(0);
	});

	it("removes its own door when its lane is disabled, and only that one", async () => {
		const fake = memoryEngine();
		await converge(fake.engine, setting, "100.88.4.2", null);

		await converge(fake.engine, { ...setting, lanes: { ...setting.lanes, private: null } }, "100.88.4.2", null);

		expect([...fake.containers.keys()]).toEqual(["deployer-door-local"]);
	});

	it("reports a failed start and leaves no container behind", async () => {
		const fake = memoryEngine();
		fake.state.failStart = "address already in use";

		const views = await converge(fake.engine, setting, null, null);

		expect(views[0]).toMatchObject({ state: "failed", detail: "address already in use" });
		expect(fake.containers.size).toBe(0);
	});

	it("waits for the overlay instead of failing hard", async () => {
		const fake = memoryEngine();
		fake.state.network = false;

		const [local] = await converge(fake.engine, setting, null, null);

		expect(local?.state).toBe("absent");
		expect(fake.counts.created).toBe(0);
	});

	it("labels its doors so it only ever touches its own", async () => {
		const fake = memoryEngine();
		await converge(fake.engine, setting, null, null);

		const labels = fake.containers.get("deployer-door-local")?.labels ?? {};

		expect(labels[DOOR_LABEL]).toBe("local");
		expect(labels[DOOR_HASH_LABEL]).toMatch(/^[0-9a-f]{16}$/);
	});
});
