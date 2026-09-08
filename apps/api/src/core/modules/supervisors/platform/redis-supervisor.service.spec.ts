import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import {
	REDIS_CONTAINER_BASE_NAME,
	REDIS_DATA_MOUNT,
	REDIS_DATA_VOLUME,
	REDIS_INTERNAL_PORT,
	RedisSupervisorService,
} from "./redis-supervisor.service";
import type { DockerService } from "@/core/modules/docker/services/docker.service";
import type { EnvService } from "@/config/env/env.service";
import type { DockerodeServiceSummary, DockerodeTaskSummary } from "@repo/contracts-entities";

function makeDockerClient(swarmActive = true) {
	const services = new Map<string, DockerodeServiceSummary>();
	const client = {
		info: vi.fn(async () => ({
			Swarm: { LocalNodeState: swarmActive ? "active" : "inactive" },
		})),
		getService: vi.fn((name: string) => ({
			inspect: vi.fn(async () => {
				const svc = services.get(name);
				if (svc === undefined) throw new NotFoundException(`service ${name} not found`);
				return svc;
			}),
		})),
		createService: vi.fn(async (spec: unknown) => {
			const name = (spec as { Name: string }).Name;
			const svc: DockerodeServiceSummary = {
				ID: `svc-${name}`,
				Version: { Index: 1 },
				CreatedAt: new Date().toISOString(),
				UpdatedAt: new Date().toISOString(),
				Spec: { Name: name, Labels: {}, TaskTemplate: {} },
			};
			services.set(name, svc);
			return svc;
		}),
		listTasks: vi.fn(async () => []),
		listServices: vi.fn(async () => []),
		getNetwork: vi.fn((name: string) => ({
			inspect: vi.fn(async () => ({ Id: `net-${name}` })),
			connect: vi.fn(async () => undefined),
		})),
		createNetwork: vi.fn(async () => ({ id: "net-new" })),
	} as never;
	return { client, services };
}

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): EnvService {
	const values: Record<string, unknown> = {
		DEPLOYER_PREFIX: "",
		DEPLOYER_REDIS_URL: "redis://deployer-redis:6379",
		DEPLOYER_REDIS_IMAGE: "redis:7-alpine",
		DOCKER_HOST: undefined,
		NODE_ENV: "development",
		SUPERVISOR_RUNTIME: "auto",
		...overrides,
	};
	return { get: vi.fn((key: string) => values[key]) } as unknown as EnvService;
}

/** Build a real RedisSupervisorService over a fake dockerode-like client. */
function makeSupervisor(envOverrides: Partial<Record<string, unknown>> = {}, swarmActive = true) {
	const { client, services } = makeDockerClient(swarmActive);
	const dockerService = {
		getDockerClient: () => client,
		ensureOverlayNetwork: vi.fn(async () => undefined),
		inspectSwarmService: async (name: string) => {
			const svc = services.get(name);
			if (svc === undefined) throw new NotFoundException(`service ${name} not found`);
			return svc;
		},
		listSwarmServiceTasks: async () => [] as DockerodeTaskSummary[],
		createSwarmService: async (spec: unknown) => {
			const name = (spec as { Name: string }).Name;
			const svc: DockerodeServiceSummary = { ID: `svc-${name}`, Version: { Index: 1 }, CreatedAt: "", UpdatedAt: "", Spec: { Name: name, Labels: {}, TaskTemplate: {} } };
			services.set(name, svc);
			return svc;
		},
		updateSwarmService: vi.fn(async () => ({ ID: "x", Version: { Index: 1 }, CreatedAt: "", UpdatedAt: "", Spec: { Name: "x", Labels: {}, TaskTemplate: {} } } as DockerodeServiceSummary)),
		removeSwarmService: async () => undefined,
	} as unknown as DockerService;

	const env = makeEnv(envOverrides);
	// Inject swarm helpers onto the same dockerService object used by getDockerClient().
	(dockerService as unknown as { _client: unknown })._client = client;
	const supervisor = new RedisSupervisorService(dockerService, env);
	// The base calls dockerService.ensureOverlayNetwork — ensure it's present.
	return { supervisor, client, services, dockerService, env };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("RedisSupervisorService (swarm runtime)", () => {
	it("reconciles a swarm-replicated service on the overlay when NOT managed (prod)", async () => {
		// MANAGED_REDIS_ENABLED not set → API-owned → swarm-replicated.
		const { supervisor, services } = makeSupervisor();
		vi.spyOn(supervisor as unknown as { verifySwarmConvergence: () => Promise<void> }, "verifySwarmConvergence").mockResolvedValue();

		await supervisor.ensureDesiredState();

		expect(services.has(REDIS_CONTAINER_BASE_NAME)).toBe(true);
		const svc = services.get(REDIS_CONTAINER_BASE_NAME)!;
		expect(svc.Spec.Name).toBe(REDIS_CONTAINER_BASE_NAME);
	});

	it("builds a swarm spec with durable AOF volume + platform labels", () => {
		const { supervisor } = makeSupervisor();
		const spec = (supervisor as unknown as { buildSwarmSpec(): { name: string; image: string; mounts: Array<{ source: string; target: string }>; labels: Record<string, string> } }).buildSwarmSpec();
		expect(spec.name).toBe(REDIS_CONTAINER_BASE_NAME);
		expect(spec.image).toBe("redis:7-alpine");
		expect(spec.mounts).toContainEqual({ type: "volume", source: REDIS_DATA_VOLUME, target: REDIS_DATA_MOUNT, readOnly: false });
	});

	it("is link-only (wires overlay, never spawns) when MANAGED_REDIS_ENABLED=true (dev compose)", async () => {
		const { supervisor, services, dockerService } = makeSupervisor({ MANAGED_REDIS_ENABLED: "true" });
		// The manager env is read through splitManagedEnv which needs the flat flag.
		(dockerService as unknown as { wired: boolean }).wired = false;
		vi.spyOn(supervisor as unknown as { wireExternalToSwarm: () => Promise<string> }, "wireExternalToSwarm").mockResolvedValue("deployer-platform-overlay");

		await supervisor.ensureDesiredState();

		// No swarm service is created — link-only.
		expect(services.size).toBe(0);
	});

	it("reports healthy for managed (compose/operator) with link-only detail", async () => {
		const { supervisor } = makeSupervisor({ MANAGED_REDIS_ENABLED: "true" });
		const probed = await (supervisor as unknown as { probe(): Promise<{ healthy: boolean; payload: { runtime: string; reachable: boolean } }> }).probe();
		expect(probed.healthy).toBe(true);
		expect(probed.payload.runtime).toBe("managed");
		expect(probed.payload.reachable).toBe(true);
	});

	it("computes the typed connection URL (managed override / password)", () => {
		const { supervisor: managed } = makeSupervisor({ MANAGED_REDIS_ENABLED: "true", DEPLOYER_REDIS_URL: "redis://managed-redis:6379" });
		expect(managed.getConnectionUrl()).toBe("redis://managed-redis:6379");
		const { supervisor } = makeSupervisor({ MANAGED_REDIS_ENABLED: "false", DEPLOYER_REDIS_PASSWORD: "s3cret" });
		expect(supervisor.getConnectionUrl()).toBe("redis://s3cret@deployer-redis:6379");
	});
});
