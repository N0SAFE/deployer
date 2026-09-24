import { describe, expect, it, vi, beforeEach } from "vitest";
import { LocalInitializationService } from "./local-initialization.service";
import { SetupStepTracker } from "../utils/setup-runner.utils";
import type { NodeConfigRepository } from "../repositories/node-config.repository";
import type { PostgresServiceProvisioner } from "@/core/modules/docker/containers/postgres/postgres-service.provisioner";
import type { EnvService } from "@repo/nest-env";
import type { SwarmBootstrapService } from "@/core/modules/swarm/services/swarm-bootstrap.service";
import type { SwarmClusterService } from "@/core/modules/swarm/services/swarm-cluster.service";
import type { SupervisorOrchestratorService } from "@/core/modules/supervisors/supervisor-orchestrator.service";
import type { DockerService } from "@/core/modules/docker/services/docker.service";
import type { EmitEvent } from "../utils/setup-runner.utils";

/**
 * Unit test for the `databaseProvisioning` marker persisted during
 * `register_node`. This marker drives GlobalDbSupervisorService activation:
 * "local" → container supervised; "external" → no supervision.
 *
 * Heavy steps (provision, migrate, seed) are short-circuited via private-method
 * spies so the flow is fully deterministic with zero Postgres/auth side effects.
 */

const LOCAL_URL = "postgres://deployer:deployer@172.17.0.1:5432/deployer";
const EXTERNAL_URL = "postgres://user:pass@db.example.com:5432/prod";

function makeMocks() {
	const upsert = vi.fn((data: unknown) => data);
	const nodeConfigRepository = {
		find: vi.fn(() => null),
		upsert,
	} as unknown as NodeConfigRepository;
	const postgresProvisioner = {
		ensure: vi.fn(async () => ({ name: "deployer-postgres" })),
	} as unknown as PostgresServiceProvisioner;
	const dockerService = {
		getSwarmServiceLogs: vi.fn(async () => ""),
	} as unknown as DockerService;
	const env = {
		get: vi.fn((key: string) =>
			key === "DEPLOYER_PREFIX" ? "" : key === "DB_DATABASE" ? "deployer" : undefined,
		),
	} as unknown as EnvService;
	return { nodeConfigRepository, postgresProvisioner, dockerService, env, upsert };
}

function makeService(mocks: ReturnType<typeof makeMocks>): LocalInitializationService {
	const service = new LocalInitializationService(
		mocks.postgresProvisioner,
		mocks.dockerService,
		mocks.env,
		mocks.nodeConfigRepository,
		// The flow founds the swarm before provisioning (a locally-managed
		// Postgres is a swarm service). These specs exercise the marker
		// persistence, not convergence, so a silent no-op + inactive snapshot
		// keeps them deterministic.
		{ converge: vi.fn(async () => undefined) } as unknown as SwarmBootstrapService,
		// "active" is REQUIRED for the local path: the swarm step correctly
		// throws when the cluster never comes up, because a locally-managed
		// Postgres is a swarm service that cannot be provisioned otherwise.
		{
			getLocalClusterSnapshot: vi.fn(async () => ({
				localNodeState: "active",
				nodeCount: 1,
				managerCount: 1,
				localNode: { swarmRole: "manager" },
				master: { nodeId: "self" },
			})),
		} as unknown as SwarmClusterService,
		// On-demand convergence of the app-wiring supervisor, called right
		// before the DSN is used so the overlay attach is not left to the
		// supervisor's 30s cadence. These specs assert marker persistence, not
		// network wiring, so a resolved no-op keeps them deterministic.
		{ convergeNow: vi.fn(async () => null) } as unknown as SupervisorOrchestratorService,
	);

	// Short-circuit the DB-heavy steps. The provision step sets the URL; the
	// migrate/seed steps must be no-ops for a deterministic run.
	(service as unknown as { ensureDatabaseEmpty(): Promise<string[]> }).ensureDatabaseEmpty =
		async () => [];
	(service as unknown as { runMigrations(): Promise<void> }).runMigrations = async () => {};
	(service as unknown as { seedInitialData(): Promise<{ userId: string }> }).seedInitialData =
		async () => ({ userId: "u1" });
	return service;
}

const noopEmit: EmitEvent = () => undefined;

describe("LocalInitializationService — databaseProvisioning marker", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('persists databaseProvisioning="local" when the API provisions its own Postgres container', async () => {
		const mocks = makeMocks();
		const service = makeService(mocks);
		// No existingDatabaseUrl → provisionDockerDatabase path (locally managed).
		(service as unknown as { provisionDockerDatabase(): Promise<string> }).provisionDockerDatabase =
			async () => LOCAL_URL;

		await service.initialize(
			{
				strategy: "local",
				name: "Admin",
				email: "admin@test.com",
				password: "password123",
				serverUrl: "http://127.0.0.1:3001",
			},
			new SetupStepTracker(),
			noopEmit,
		);

		expect(mocks.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				databaseUrl: LOCAL_URL,
				databaseProvisioning: "local",
			}),
		);
	});

	it('persists databaseProvisioning="external" when an existing database URL is supplied', async () => {
		const mocks = makeMocks();
		const service = makeService(mocks);
		// existingDatabaseUrl → probeExistingDatabase path (externally managed).
		(service as unknown as { probeExistingDatabase(): Promise<string> }).probeExistingDatabase =
			async () => EXTERNAL_URL;

		await service.initialize(
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
		);

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
		mocks.nodeConfigRepository.find = vi.fn(() => ({
			nodeId: "n1",
			strategy: "local",
			setupState: "not_started",
			databaseUrl: EXTERNAL_URL,
			databaseProvisioning: "external",
			configuredAt: null,
			meshUrlsSnapshot: [],
			updatedAt: "2026-01-01T00:00:00.000Z",
		}) as never);

		const service = makeService(mocks);
		const probeSpy = vi.fn(async () => EXTERNAL_URL);
		(service as unknown as { probeExistingDatabase(): Promise<string> }).probeExistingDatabase = probeSpy;
		const provisionSpy = vi.fn(async () => {
			throw new Error("must not provision a container when a DB is provided");
		});
		(service as unknown as { provisionDockerDatabase(): Promise<string> }).provisionDockerDatabase = provisionSpy;

		await service.initialize(
			{
				strategy: "local",
				name: "Admin",
				email: "admin@test.com",
				password: "password123",
				serverUrl: "http://127.0.0.1:3001",
			},
			new SetupStepTracker(),
			noopEmit,
		);

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