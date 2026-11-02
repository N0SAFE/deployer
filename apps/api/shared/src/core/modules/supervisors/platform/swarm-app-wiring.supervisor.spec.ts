import { Effect, Stream } from "effect";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { DockerNotFound } from "@deployer/docker";
import type { DockerEngineShape } from "@deployer/docker";

import { harness, testBus } from "../supervisor-test-harness";

import { makeSwarmAppWiringRegistration } from "./swarm-app-wiring.supervisor";

import type { EnvService } from "../../../../config/env/env.module";

const PLATFORM_NETWORK = "deployer-platform";
const OVERLAY = "deployer-platform-overlay";
const SELF_ID = "aaaaaaaaaaaabbbbbbbbbbbbccccccccccccdddddddddddd";

type FakeContainer = {
	id: string;
	name: string;
	/** Aliases declared on the platform (compose) network. */
	platformAliases: string[];
	/** True when already attached to the overlay. */
	onOverlay: boolean;
	/** Aliases currently declared on the overlay. */
	overlayAliases: string[];
}

/**
 * Fake dockerode surface: a container list + per-container inspect, plus the
 * overlay network's connect/disconnect. Containers are addressed by ID (as the
 * engine does) and matched against configured ALIASES (as compose declares).
 */
function makeDocker(options: { swarmActive: boolean; containers: FakeContainer[] }) {
	const containers = new Map(options.containers.map((c) => [c.id, c]));
	const connects: { container: string; aliases: string[] }[] = [];

	const findContainer = (idOrName: string) =>
		containers.get(idOrName) ?? [...containers.values()].find((c) => c.name === idOrName);

	const ensureOverlayNetwork = vi.fn((_request: unknown) => Effect.void);

	const engine = {
		containers: {
			list: vi.fn(() =>
				Effect.succeed(
					[...containers.values()].filter((c) => c.platformAliases.length > 0).map((c) => ({ Id: c.id })),
				),
			),
			inspect: vi.fn((idOrName: string) => {
				const found = findContainer(idOrName);
				if (found === undefined) {
					return Effect.fail(new DockerNotFound({ resource: `container '${idOrName}'` }));
				}
				const networks: Record<string, { Aliases: string[] }> = {
					[PLATFORM_NETWORK]: { Aliases: found.platformAliases },
				};
				if (found.onOverlay) networks[OVERLAY] = { Aliases: found.overlayAliases };
				return Effect.succeed({ Name: `/${found.name}`, NetworkSettings: { Networks: networks } });
			}),
		},
		networks: {
			ensureOverlay: ensureOverlayNetwork,
			attachContainer: vi.fn((_overlay: string, id: string, aliases: readonly string[] = []) => {
				const container = containers.get(id);
				if (container === undefined) {
					return Effect.fail(new DockerNotFound({ resource: `container '${id}'` }));
				}
				connects.push({ container: container.name, aliases: [...aliases] });
				container.onOverlay = true;
				container.overlayAliases = [...aliases];
				return Effect.void;
			}),
			detachContainer: vi.fn((_overlay: string, id: string) => {
				const container = containers.get(id);
				if (container !== undefined) {
					container.onOverlay = false;
					container.overlayAliases = [];
				}
				return Effect.void;
			}),
		},
		// Inert event stream: the supervisor subscribes but nothing is emitted.
		events: { stream: vi.fn(() => Stream.never) },
		swarmCluster: { isActive: () => Effect.succeed(options.swarmActive) },
	};

	const dockerService = engine as unknown as DockerEngineShape;

	return { dockerService, containers, connects, ensureOverlayNetwork };
}

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): EnvService {
	const values: Record<string, unknown> = {
		DEPLOYER_PREFIX: "",
		DEPLOYER_API_TARGET: "api-dev",
		DEPLOYER_WEB_TARGET: "web-dev",
		...overrides,
	};
	return { get: vi.fn((key: string) => values[key]) } as never;
}

/** The API container itself, as compose creates it (aliases include api-dev). */
function apiContainer(overrides: Partial<FakeContainer> = {}): FakeContainer {
	return {
		id: SELF_ID,
		name: "nextjs-nestjs-api-dev",
		platformAliases: ["nextjs-nestjs-api-dev", "api-dev", "api"],
		onOverlay: false,
		overlayAliases: [],
		...overrides,
	};
}

/** The web container, as compose creates it (aliases include web-dev). */
function webContainer(overrides: Partial<FakeContainer> = {}): FakeContainer {
	return {
		id: "bbbbbbbbbbbbccccccccccccddddddddddeeeeeeeeeeee",
		name: "nextjs-nestjs-web-dev",
		platformAliases: ["nextjs-nestjs-web-dev", "web-dev"],
		onOverlay: false,
		overlayAliases: [],
		...overrides,
	};
}

describe("swarm app-wiring supervisor", () => {
	let originalHostname: string | undefined;

	beforeEach(() => {
		originalHostname = process.env.HOSTNAME;
		process.env.HOSTNAME = SELF_ID;
	});

	afterEach(() => {
		process.env.HOSTNAME = originalHostname;
		vi.restoreAllMocks();
	});

	it("is a no-op while the engine is not swarm-active (container phase)", async () => {
		const docker = makeDocker({ swarmActive: false, containers: [apiContainer()] });
		const supervisor = harness(makeSwarmAppWiringRegistration({ engine: docker.dockerService, env: makeEnv(), bus: testBus() }));

		await supervisor.ensureDesiredState();

		expect(docker.ensureOverlayNetwork).not.toHaveBeenCalled();
		expect(docker.connects).toHaveLength(0);
	});

	it("resolves compose ALIASES to real containers and wires them", async () => {
		const docker = makeDocker({
			swarmActive: true,
			containers: [apiContainer(), webContainer()],
		});
		const supervisor = harness(makeSwarmAppWiringRegistration({ engine: docker.dockerService, env: makeEnv(), bus: testBus() }));

		await supervisor.ensureDesiredState();

		expect(docker.ensureOverlayNetwork).toHaveBeenCalledWith(
			expect.objectContaining({ name: OVERLAY, driver: "overlay", attachable: true }),
		);
		// The configured values are aliases (`api-dev`/`web-dev`); the ENGINE is
		// addressed by container id, so both containers must be wired.
		expect(docker.connects.map((c) => c.container).sort()).toEqual([
			"nextjs-nestjs-api-dev",
			"nextjs-nestjs-web-dev",
		]);
	});

	it("carries the container aliases onto the overlay (ingress resolves web-dev there)", async () => {
		const docker = makeDocker({ swarmActive: true, containers: [webContainer()] });
		const supervisor = harness(makeSwarmAppWiringRegistration({ engine: docker.dockerService, env: makeEnv(), bus: testBus() }));

		await supervisor.ensureDesiredState();

		const webConnect = docker.connects.find((c) => c.container === "nextjs-nestjs-web-dev");
		expect(webConnect?.aliases).toContain("web-dev");
		expect(webConnect?.aliases).toContain("nextjs-nestjs-web-dev");
	});

	it("does not fail when the web container has not started yet", async () => {
		const docker = makeDocker({ swarmActive: true, containers: [apiContainer()] });
		const supervisor = harness(makeSwarmAppWiringRegistration({ engine: docker.dockerService, env: makeEnv(), bus: testBus() }));

		// `web-dev` is declared but not created — converging must stay green.
		await expect(supervisor.ensureDesiredState()).resolves.toBe("converged");
		expect(docker.connects.map((c) => c.container)).toEqual(["nextjs-nestjs-api-dev"]);
	});

	it("is idempotent when already attached with the expected aliases", async () => {
		const docker = makeDocker({
			swarmActive: true,
			containers: [
				webContainer({
					onOverlay: true,
					overlayAliases: ["nextjs-nestjs-web-dev", "web-dev"],
				}),
			],
		});
		const supervisor = harness(makeSwarmAppWiringRegistration({ engine: docker.dockerService, env: makeEnv(), bus: testBus() }));

		await expect(supervisor.ensureDesiredState()).resolves.toBe("converged");
		expect(docker.connects).toHaveLength(0);
	});

	it("repairs an overlay attachment that is missing the alias", async () => {
		const docker = makeDocker({
			swarmActive: true,
			// Attached, but WITHOUT the `web-dev` alias — e.g. wired by an older
			// build. It must be reconnected so the ingress can resolve it.
			containers: [webContainer({ onOverlay: true, overlayAliases: ["nextjs-nestjs-web-dev"] })],
		});
		const supervisor = harness(makeSwarmAppWiringRegistration({ engine: docker.dockerService, env: makeEnv(), bus: testBus() }));

		await supervisor.ensureDesiredState();

		expect(docker.connects).toHaveLength(1);
		expect(docker.connects[0]?.aliases).toContain("web-dev");
	});

	it("reports unhealthy when a running container is not wired", async () => {
		const docker = makeDocker({ swarmActive: true, containers: [apiContainer()] });
		const supervisor = harness(makeSwarmAppWiringRegistration({ engine: docker.dockerService, env: makeEnv(), bus: testBus() }));
		await supervisor.ensureDesiredState();

		// The web container appears AFTER convergence (its start event re-wires).
		docker.containers.set("web-1", {
			id: "web-1",
			name: "nextjs-nestjs-web-dev",
			platformAliases: ["web-dev"],
			onOverlay: false,
			overlayAliases: [],
		});

		const health = await supervisor.getHealth();

		expect(health.healthy).toBe(false);
		expect(health.detail).toContain("nextjs-nestjs-web-dev");
	});

	it("reports healthy with an inactive engine (container mode is a valid state)", async () => {
		const docker = makeDocker({ swarmActive: false, containers: [apiContainer()] });
		const supervisor = harness(makeSwarmAppWiringRegistration({ engine: docker.dockerService, env: makeEnv(), bus: testBus() }));
		await supervisor.ensureDesiredState();

		const health = await supervisor.getHealth();

		expect(health.healthy).toBe(true);
		expect(health.payload.swarmActive).toBe(false);
	});

	it("exposes the overlay and per-target wiring through process info", async () => {
		const docker = makeDocker({ swarmActive: true, containers: [apiContainer(), webContainer()] });
		const supervisor = harness(makeSwarmAppWiringRegistration({ engine: docker.dockerService, env: makeEnv(), bus: testBus() }));
		await supervisor.ensureDesiredState();

		const info = await supervisor.getProcessInfo();

		expect(info.overlay).toBe(OVERLAY);
		expect(info.targets.map((target) => target.name)).toContain("nextjs-nestjs-web-dev");
	});
});
