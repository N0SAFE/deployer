import { Effect } from "effect";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { PostgresProvisionerShape } from "@deployer/docker";
import type { DockerEngineShape } from "@deployer/docker";
import type { NodeConfigRepositoryShape } from "@deployer/node-state";
import type { SupervisorOrchestratorShape } from "@deployer/supervision";
import type { SwarmBootstrapShape } from "@deployer/swarm"
import type { SwarmClusterShape } from "@deployer/swarm"

import { SetupStepTracker } from "../utils/setup-runner.utils";

import { makeLocalInitializationService, type LocalInitializationSteps } from "./local-initialization.service";

import type { EnvService } from "../../../../config/env/env.module";
import type { EmitEvent } from "../utils/setup-runner.utils";

/**
 * Unit test for the `databaseProvisioning` marker persisted during
 * `register_node`. This marker drives global-db supervisor activation:
 * "local" → container supervised; "external" → no supervision.
 *
 * Heavy steps (provision, migrate, seed) are short-circuited via private-method
 * spies so the flow is fully deterministic with zero Postgres/auth side effects.
 */

const LOCAL_URL = "postgres://deployer:deployer@172.17.0.1:5432/deployer";
const EXTERNAL_URL = "postgres://user:pass@db.example.com:5432/prod";

function makeMocks() {
	const upsert = vi.fn((data: unknown) => Effect.succeed(data));
	const nodeConfigRepository = {
		find: vi.fn(() => Effect.succeed(null)),
		upsert,
	} as unknown as NodeConfigRepositoryShape;
	const postgresProvisioner = {
		ensure: vi.fn(() => Effect.succeed({ name: "deployer-postgres" })),
	} as unknown as PostgresProvisionerShape;
	const dockerService = {
		swarmServices: { logs: vi.fn(() => Effect.succeed("")) },
	} as unknown as DockerEngineShape;
	const env = {
		get: vi.fn((key: string) =>
			key === "DEPLOYER_PREFIX" ? "" : key === "DB_DATABASE" ? "deployer" : undefined,
		),
	} as unknown as EnvService;
	return { nodeConfigRepository, postgresProvisioner, dockerService, env, upsert };
}

function makeService(mocks: ReturnType<typeof makeMocks>, steps: Partial<LocalInitializationSteps> = {}) {
	return makeLocalInitializationService({
		postgresProvisioner: mocks.postgresProvisioner,
		dockerEngine: mocks.dockerService,
		env: mocks.env,
		nodeConfigRepository: mocks.nodeConfigRepository,
		// The flow founds the swarm before provisioning (a locally-managed
		// Postgres is a swarm service). These specs exercise the marker
		// persistence, not convergence, so a silent no-op + inactive snapshot
		// keeps them deterministic.
		swarmBootstrap: { converge: vi.fn(() => Effect.void) } as unknown as SwarmBootstrapShape,
		// "active" is REQUIRED for the local path: the swarm step correctly
		// throws when the cluster never comes up, because a locally-managed
		// Postgres is a swarm service that cannot be provisioned otherwise.
		swarmCluster: {
			getLocalClusterSnapshot: vi.fn(() => Effect.succeed({
				localNodeState: "active",
				nodeCount: 1,
				managerCount: 1,
				localNode: { swarmRole: "manager" },
				master: { nodeId: "self" },
			}) as never),
		} as unknown as SwarmClusterShape,
		// On-demand convergence of the app-wiring supervisor, called right
		// before the DSN is used so the overlay attach is not left to the
		// supervisor's 30s cadence. These specs assert marker persistence, not
		// network wiring, so a resolved no-op keeps them deterministic.
		supervisors: { convergeNow: vi.fn(() => Effect.succeed(null)) } as unknown as SupervisorOrchestratorShape,
		// Short-circuit the DB-heavy steps. The provision step sets the URL; the migrate/seed steps must be no-ops for a
		// deterministic run.
		steps: {
			ensureDatabaseEmpty: () => Promise.resolve([]),
			runMigrations: () => Promise.resolve(),
			seedInitialData: () => Promise.resolve({ userId: "u1" }),
			...steps,
		},
	});

}

const noopEmit: EmitEvent = () => undefined;

describe("LocalInitializationService — databaseProvisioning marker", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('persists databaseProvisioning="local" when the API provisions its own Postgres container', async () => {
		const mocks = makeMocks();
		// No existingDatabaseUrl → provisionDockerDatabase path (locally managed).
		const service = makeService(mocks, { provisionDockerDatabase: () => Promise.resolve(LOCAL_URL) });

		await Effect.runPromise(service.initialize(
			{
				strategy: "local",
				name: "Admin",
				email: "admin@test.com",
				password: "password123",
				serverUrl: "http://127.0.0.1:3001",
			},
			new SetupStepTracker(),
			noopEmit,
		));

		expect(mocks.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				databaseUrl: LOCAL_URL,
				databaseProvisioning: "local",
			}),
		);
	});

	it('persists databaseProvisioning="external" when an existing database URL is supplied', async () => {
		const mocks = makeMocks();
		// existingDatabaseUrl → probeExistingDatabase path (externally managed).
		const service = makeService(mocks, { probeExistingDatabase: () => Promise.resolve(EXTERNAL_URL) });

		await Effect.runPromise(service.initialize(
			{
				strategy: "local",
				name: "Admin",
				email: "admin@test.com",
				password: "password123",
				existingDatabaseUrl: EXTERNAL_URL,
				serverUrl: "http://127.0.0.1:3001",
			},
			new SetupStepTracker(),
			noopEmit,
		));

		expect(mocks.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				databaseUrl: EXTERNAL_URL,
				databaseProvisioning: "external",
			}),
		);
	});

	it('uses the node-provided DB (SETUP CANDIDATE) when no URL is supplied — instead of provisioning a container', async () => {
		const mocks = makeMocks();
		// Phase 0 persisted a compose-managed DB as a candidate (not configured).
		(mocks.nodeConfigRepository as { find: unknown }).find = vi.fn(() => Effect.succeed({
			nodeId: "n1",
			strategy: "local",
			setupState: "not_started",
			databaseUrl: EXTERNAL_URL,
			databaseProvisioning: "external",
			configuredAt: null,
			meshUrlsSnapshot: [],
			updatedAt: "2026-01-01T00:00:00.000Z",
		}) as never);

		const probeSpy = vi.fn((_url: string, _log: (message: string) => void) => Promise.resolve(EXTERNAL_URL));
		const provisionSpy = vi.fn(() => Promise.reject(new Error("must not provision a container when a DB is provided")));
		const service = makeService(mocks, { probeExistingDatabase: probeSpy, provisionDockerDatabase: provisionSpy });

		await Effect.runPromise(service.initialize(
			{
				strategy: "local",
				name: "Admin",
				email: "admin@test.com",
				password: "password123",
				serverUrl: "http://127.0.0.1:3001",
			},
			new SetupStepTracker(),
			noopEmit,
		));

		expect(provisionSpy).not.toHaveBeenCalled();
		expect(probeSpy).toHaveBeenCalledWith(EXTERNAL_URL, expect.any(Function));
		expect(mocks.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				databaseUrl: EXTERNAL_URL,
				databaseProvisioning: "external",
			}),
		);
	});
});