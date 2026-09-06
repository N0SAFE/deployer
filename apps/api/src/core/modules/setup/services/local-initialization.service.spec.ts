import { describe, expect, it, vi, beforeEach } from "vitest";
import { LocalInitializationService } from "./local-initialization.service";
import { SetupStepTracker } from "../utils/setup-runner.utils";
import type { NodeConfigRepository } from "../repositories/node-config.repository";
import type { PostgresContainerService } from "@/core/modules/docker/containers/postgres/postgres-container.service";
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
	const postgresContainerService = {
		startPostgresContainer: vi.fn(async () => ({ id: "pg-1" })),
	} as unknown as PostgresContainerService;
	const dockerService = {} as unknown as DockerService;
	return { nodeConfigRepository, postgresContainerService, dockerService, upsert };
}

function makeService(mocks: ReturnType<typeof makeMocks>): LocalInitializationService {
	const service = new LocalInitializationService(
		mocks.postgresContainerService,
		mocks.dockerService,
		mocks.nodeConfigRepository,
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
});