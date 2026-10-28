import { Effect, Fiber, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

import { DockerNotFound, type DockerEngineShape } from "@deployer/docker";

import { makeSwarmAppWiring, type SwarmAppWiringConfig } from "./swarm-app-wiring";

const PLATFORM = "deployer-platform";
const OVERLAY = "deployer-platform-overlay";
const SELF_ID = "aaaaaaaaaaaabbbbbbbbbbbbccccccccccccdddddddddddd";

type FakeContainer = { id: string; name: string; platformAliases: string[]; overlayAliases: string[] | null };

const apiContainer = (): FakeContainer => ({
	id: SELF_ID,
	name: "stack-api-dev",
	platformAliases: ["stack-api-dev", "api-dev"],
	overlayAliases: null,
});
const webContainer = (overlayAliases: string[] | null = null): FakeContainer => ({
	id: "bbbbbbbbbbbbccccccccccccddddddddddeeeeeeeeeeee",
	name: "stack-web-dev",
	platformAliases: ["stack-web-dev", "web-dev"],
	overlayAliases,
});

function setup(options: { swarmActive?: boolean; containers: FakeContainer[]; events?: Stream.Stream<unknown> }) {
	const containers = new Map(options.containers.map((c) => [c.id, c]));
	const attaches: { name: string; aliases: readonly string[] }[] = [];
	const detaches: string[] = [];
	const ensureOverlay = vi.fn(() => Effect.void);
	const find = (id: string) => containers.get(id) ?? [...containers.values()].find((c) => c.name === id);

	const engine = {
		containers: {
			list: () => Effect.succeed([...containers.values()].map((c) => ({ Id: c.id }))),
			inspect: (id: string) => {
				const found = find(id);
				if (found === undefined) return Effect.fail(new DockerNotFound({ resource: id }));
				const networks: Record<string, { Aliases: string[] }> = { [PLATFORM]: { Aliases: found.platformAliases } };
				if (found.overlayAliases !== null) networks[OVERLAY] = { Aliases: found.overlayAliases };
				return Effect.succeed({ Name: `/${found.name}`, NetworkSettings: { Networks: networks } });
			},
		},
		networks: {
			ensureOverlay,
			attachContainer: (_overlay: string, id: string, aliases: readonly string[] = []) => {
				const found = containers.get(id);
				if (found === undefined) return Effect.fail(new DockerNotFound({ resource: id }));
				attaches.push({ name: found.name, aliases });
				found.overlayAliases = [...aliases];
				return Effect.void;
			},
			detachContainer: (_overlay: string, id: string) => {
				const found = containers.get(id);
				if (found) {
					detaches.push(found.name);
					found.overlayAliases = null;
				}
				return Effect.void;
			},
		},
		events: { stream: () => options.events ?? Stream.never },
		swarmCluster: { isActive: () => Effect.succeed(options.swarmActive ?? true) },
	} as unknown as DockerEngineShape;

	const logger = { log: vi.fn(), debug: vi.fn(), warn: vi.fn() };
	const config: SwarmAppWiringConfig = {
		overlay: () => OVERLAY,
		platformNetwork: () => PLATFORM,
		declaredTargets: () => ["api-dev", "web-dev"],
		selfHostname: () => SELF_ID,
	};
	return { wiring: makeSwarmAppWiring({ engine, config, logger }), attaches, detaches, ensureOverlay, logger, containers };
}

describe("swarm app wiring", () => {
	it("does nothing while the engine is not a swarm member", async () => {
		const { wiring, attaches, ensureOverlay } = setup({ swarmActive: false, containers: [apiContainer()] });
		await Effect.runPromise(wiring.spec.converge);
		expect(ensureOverlay).not.toHaveBeenCalled();
		expect(attaches).toHaveLength(0);
		const probe = await Effect.runPromise(wiring.spec.probe);
		expect(probe.healthy).toBe(true);
		expect(probe.payload.swarmActive).toBe(false);
	});

	it("attaches each running target to the overlay carrying its aliases, and logs the change once", async () => {
		const { wiring, attaches, logger } = setup({ containers: [apiContainer(), webContainer()] });
		await Effect.runPromise(wiring.spec.converge);
		expect(attaches.map((a) => a.name).sort()).toEqual(["stack-api-dev", "stack-web-dev"]);
		expect(attaches.find((a) => a.name === "stack-web-dev")?.aliases).toEqual(expect.arrayContaining(["web-dev", "stack-web-dev"]));
		expect(logger.log).toHaveBeenCalledTimes(1);

		await Effect.runPromise(wiring.spec.converge);
		expect(attaches).toHaveLength(2);
		expect(logger.log).toHaveBeenCalledTimes(1);
	});

	it("re-attaches an endpoint whose aliases are stale", async () => {
		const { wiring, attaches, detaches } = setup({ containers: [apiContainer(), webContainer(["stack-web-dev"])] });
		await Effect.runPromise(wiring.spec.converge);
		expect(detaches).toEqual(["stack-web-dev"]);
		expect(attaches.find((a) => a.name === "stack-web-dev")?.aliases).toContain("web-dev");
	});

	it("reports an unwired running container as unhealthy, naming it", async () => {
		const { wiring } = setup({ containers: [apiContainer(), webContainer()] });
		const probe = await Effect.runPromise(wiring.spec.probe);
		expect(probe.healthy).toBe(false);
		expect(probe.detail).toContain("stack-web-dev");
	});

	it("is not an error when a configured target is not running yet", async () => {
		const { wiring } = setup({ containers: [apiContainer()] });
		await Effect.runPromise(wiring.spec.converge);
		const probe = await Effect.runPromise(wiring.spec.probe);
		expect(probe.healthy).toBe(true);
		expect(probe.payload.targets.map((t) => t.name)).toEqual(["stack-api-dev"]);
	});

	it("re-converges when a start event names a target, and ignores other containers", async () => {
		const events = Stream.fromIterable([
			{ Actor: { Attributes: { name: "unrelated" } } },
			{ Actor: { Attributes: { name: "web-dev" } } },
			{ nonsense: true },
		]);
		const { wiring } = setup({ containers: [apiContainer(), webContainer()], events });
		const ensure = vi.fn(() => Effect.void);
		const fiber = Effect.runFork(wiring.background(Effect.sync(ensure)));
		await new Promise((resolve) => setTimeout(resolve, 30));
		await Effect.runPromise(Fiber.interrupt(fiber));
		expect(ensure).toHaveBeenCalledTimes(1);
	});
});
