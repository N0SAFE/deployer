import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { DockerEngineShape } from "@deployer/docker";

import type { EnvService } from "../../../../config/env/env.module";
import { makeRedisRegistration } from "./redis.supervisor";
import { harness, testBus } from "../supervisor-test-harness";

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): EnvService {
	const values: Record<string, unknown> = {
		DEPLOYER_PREFIX: "",
		DEPLOYER_REDIS_URL: "redis://deployer-redis:6379",
		DEPLOYER_REDIS_IMAGE: "redis:7-alpine",
		...overrides,
	};
	// Only reads are needed; `splitManagedEnv` reads the flat `MANAGED_REDIS_*` keys through `get`.
	return { get: vi.fn((key: string) => values[key]) } as unknown as EnvService;
}

function makeSupervisor(envOverrides: Partial<Record<string, unknown>> = {}) {
	const reconcile = vi.fn(() => Effect.void);
	const connectContainer = vi.fn(() => Effect.void);
	const engine = {
		swarmCluster: { isActive: () => Effect.succeed(true) },
		networks: { ensureOverlay: () => Effect.void, connectContainer },
		swarmServices: {
			reconcile,
			inspect: (name: string) => Effect.succeed({ ID: `svc-${name}`, Spec: { Name: name } }),
			listTasks: () => Effect.succeed([]),
		},
	};
	const dockerService = engine as unknown as DockerEngineShape;
	const { registration, redis } = makeRedisRegistration({ engine: dockerService, env: makeEnv(envOverrides), bus: testBus() });
	return { supervisor: harness(registration), redis, reconcile, connectContainer };
}

describe("redis supervisor registration", () => {
	it("converges a swarm service through the engine when API-owned", async () => {
		const { supervisor, reconcile } = makeSupervisor();
		expect(await supervisor.ensureDesiredState()).toBe("converged");
		expect(reconcile).toHaveBeenCalledOnce();
	});

	it("is link-only when MANAGED_REDIS_ENABLED=true: wires the overlay, schedules nothing", async () => {
		const { supervisor, reconcile, connectContainer } = makeSupervisor({ MANAGED_REDIS_ENABLED: "true" });
		await supervisor.ensureDesiredState();
		expect(reconcile).not.toHaveBeenCalled();
		expect(connectContainer).toHaveBeenCalledOnce();
	});

	it("reports health through the supervisor lifecycle", async () => {
		const { supervisor } = makeSupervisor({ MANAGED_REDIS_ENABLED: "true" });
		// Health includes the lifecycle state, so converge first: a supervisor that has not run is pending.
		await supervisor.ensureDesiredState();
		const health = await supervisor.getHealth();
		expect(health).toMatchObject({ healthy: true, payload: { runtime: "managed" } });
	});

	it("exposes the typed connection URL", () => {
		expect(makeSupervisor().redis.connectionUrl()).toBe("redis://deployer-redis:6379");
		expect(makeSupervisor({ DEPLOYER_REDIS_URL: "", DEPLOYER_REDIS_PASSWORD: "s3cret" }).redis.connectionUrl()).toBe(
			"redis://s3cret@deployer-redis:6379",
		);
	});
});
