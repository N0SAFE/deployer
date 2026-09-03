import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import {
	REDIS_CONTAINER_BASE_NAME,
	REDIS_DATA_MOUNT,
	REDIS_DATA_VOLUME,
	REDIS_INTERNAL_PORT,
	RedisSupervisorService,
} from "./redis-supervisor.service";
import type { DockerService } from "@/core/modules/docker/services/docker.service";
import type { EnvService } from "@/config/env/env.service";

type InspectResult = { Id: string; State: { Running: boolean; ExitCode?: number } };
type DockerodeError = Error & { statusCode?: number };

function makeDockerClient() {
	const containers = new Map<string, InspectResult>();
	const client = {
		getContainer: vi.fn((name: string) => ({
			inspect: vi.fn(async () => {
				const state = containers.get(name);
				if (state === undefined) {
					const err = new Error("not found") as DockerodeError;
					err.statusCode = 404;
					throw err;
				}
				return {
					Id: state.Id,
					State: state.State,
					Config: {},
					HostConfig: {},
				};
			}),
			start: vi.fn(async () => {
				const state = containers.get(name);
				if (state !== undefined) state.State.Running = true;
			}),
			remove: vi.fn(async () => {
				containers.delete(name);
			}),
		})),
		createContainer: vi.fn(async (opts: { name: string }) => {
			const state: InspectResult = { Id: `id-${opts.name}`, State: { Running: false, ExitCode: 0 } };
			containers.set(opts.name, state);
			return {
				id: state.Id,
				start: vi.fn(async () => {
					state.State.Running = true;
				}),
				inspect: vi.fn(async () => state),
			};
		}),
		getNetwork: vi.fn((name: string) => ({
			inspect: vi.fn(async () => ({ Id: `net-${name}` })),
			connect: vi.fn(async () => undefined),
		})),
		getVolume: vi.fn((name: string) => ({
			inspect: vi.fn(async () => {
				throw Object.assign(new Error("not found"), { statusCode: 404 });
			}),
		})),
		createVolume: vi.fn(async () => ({ name: "created" })),
		pull: vi.fn((_image: string, cb: (err: Error | null, stream: NodeJS.ReadableStream | null) => void) => {
			const stream = new PassThrough();
			cb(null, stream);
			queueMicrotask(() => stream.end());
		}),
	};
	return { client, containers };
}

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): EnvService {
	const values: Record<string, unknown> = {
		DEPLOYER_PREFIX: "",
		DEPLOYER_REDIS_URL: "redis://deployer-redis:6379",
		DEPLOYER_REDIS_IMAGE: "redis:7-alpine",
		DOCKER_HOST: undefined,
		NODE_ENV: "development",
		...overrides,
	};
	return { get: vi.fn((key: string) => values[key]) } as unknown as EnvService;
}

function makeSupervisor(envOverrides: Partial<Record<string, unknown>> = {}) {
	const { client, containers } = makeDockerClient();
	const dockerService = { getDockerClient: () => client } as unknown as DockerService;
	const env = makeEnv(envOverrides);
	const supervisor = new RedisSupervisorService(dockerService, env);
	return { supervisor, client, containers, env };
}

/** Make `redis-cli ping` exec return PONG inside the harness. */
function stubExecPong() {
	// The probe uses container.exec(...).start — provide a fake exec per probe.
	const execBehavior = new Map<string, string>();

	const original = vi.spyOn(RedisSupervisorService.prototype as unknown as {
		execRedisCli: (name: string, args: string[]) => Promise<string>;
	}, "execRedisCli").mockImplementation(async (_name: string, args: string[]) => {
		return execBehavior.get(args.join(" ")) ?? "PONG";
	});
	return { execBehavior, restore: () => original.mockRestore() };
}

afterEach(() => {
	delete process.env.HOSTNAME;
	vi.restoreAllMocks();
});

describe("RedisSupervisorService (API-supervised Redis, D-5)", () => {
	it("converges by creating a redis container on the platform network with durable storage", async () => {
		process.env.HOSTNAME = "0123456789ab";
		const { supervisor, client } = makeSupervisor();
		// Skip the real redis-cli exec in converge verification.
		vi.spyOn(supervisor as unknown as { verifyConvergence: () => Promise<void> }, "verifyConvergence").mockResolvedValue();

		await supervisor.ensureDesiredState();

		const createArgs = vi.mocked(client.createContainer).mock.calls[0]?.[0] as Record<string, unknown>;
		expect(createArgs.name).toBe(REDIS_CONTAINER_BASE_NAME);
		expect(createArgs.Image).toBe("redis:7-alpine");
		const cmd = createArgs.Cmd as string[];
		expect(cmd).toContain("--appendonly");
		expect(cmd).toContain("yes");
		// Durable AOF data volume + platform network join (headless by default).
		expect(createArgs.HostConfig).toMatchObject({
			Binds: [`${REDIS_DATA_VOLUME}:${REDIS_DATA_MOUNT}`],
		});
		// Network attach goes through HostConfig.NetworkMode (dockerode wiring
		// in BaseDockerSupervisorService.createContainer) — the resolved
		// network ID for `deployer-platform`.
		const hostConfig = createArgs.HostConfig as Record<string, unknown>;
		expect(hostConfig.NetworkMode).toBe("net-deployer-platform");
		// Headless: no host port binding by default.
		expect(hostConfig.PortBindings).toBeUndefined();
	});

	it("publishes an optional host port when DEPLOYER_REDIS_PORT is set (debugging)", async () => {
		process.env.HOSTNAME = "0123456789ab";
		const { supervisor, client } = makeSupervisor({ DEPLOYER_REDIS_PORT: 16379 });
		vi.spyOn(supervisor as unknown as { verifyConvergence: () => Promise<void> }, "verifyConvergence").mockResolvedValue();

		await supervisor.ensureDesiredState();

		const createArgs = vi.mocked(client.createContainer).mock.calls[0]?.[0] as Record<string, unknown>;
		const hostConfig = createArgs.HostConfig as Record<string, unknown>;
		expect(hostConfig.PortBindings).toEqual({
			[`${REDIS_INTERNAL_PORT}/tcp`]: [{ HostPort: "16379" }],
		});
	});

	it("reports healthy when redis-cli ping returns PONG (real probe)", async () => {
		process.env.HOSTNAME = "0123456789ab";
		const { supervisor, containers } = makeSupervisor();

		vi.spyOn(supervisor as unknown as { verifyConvergence: () => Promise<void> }, "verifyConvergence").mockResolvedValue();
		const exec = stubExecPong();
		exec.execBehavior.set("ping", "PONG");
		exec.execBehavior.set("info server", "redis_version:7.2.4\r\n");

		await supervisor.ensureDesiredState();
		const probed = await (supervisor as unknown as { probe(): Promise<unknown> }).probe() as {
			healthy: boolean;
			payload: { ping: string | null; redisVersion: string | null; reachable: boolean; host: string; port: number };
		};

		expect(probed.healthy).toBe(true);
		expect(probed.payload.ping).toBe("PONG");
		expect(probed.payload.redisVersion).toBe("7.2.4");
		expect(probed.payload.reachable).toBe(true);
		expect(probed.payload.host).toBe(REDIS_CONTAINER_BASE_NAME);
		expect(probed.payload.port).toBe(REDIS_INTERNAL_PORT);
		exec.restore();
	});

	it("reports unhealthy when the container is not running", async () => {
		process.env.HOSTNAME = "0123456789ab";
		const { supervisor, containers } = makeSupervisor();

		const probed = await (supervisor as unknown as { probe(): Promise<unknown> }).probe() as {
			healthy: boolean;
			payload: { reachable: boolean; ping: string | null };
		};

		expect(probed.healthy).toBe(false);
		expect(probed.payload.reachable).toBe(false);
		expect(probed.payload.ping).toBeNull();
	});

	it("computes the typed connection URL over the platform network (with optional password)", () => {
		// No explicit DEPLOYER_REDIS_URL → the supervised container URL is used.
		const { supervisor } = makeSupervisor({ DEPLOYER_REDIS_URL: undefined, DEPLOYER_REDIS_PASSWORD: "s3cret" });
		const { supervisor: noPassword } = makeSupervisor({ DEPLOYER_REDIS_URL: undefined });

		expect(supervisor.getConnectionUrl()).toBe("redis://s3cret@deployer-redis:6379");
		expect(noPassword.getConnectionUrl()).toBe("redis://deployer-redis:6379");
	});
});