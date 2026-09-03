import { describe, expect, it, vi } from "vitest";
import {
	GlobalDbSupervisorService,
	GLOBAL_DB_SUPERVISOR_ID,
} from "./global-db-supervisor.service";
import { SupervisorOrchestratorService } from "@/core/modules/supervisors/supervisor-orchestrator.service";
import type { DockerService } from "@/core/modules/docker/services/docker.service";
import type { PostgresContainerService } from "@/core/modules/docker/containers/postgres/postgres-container.service";
import type { NodeConfigRepository } from "@/core/modules/setup/repositories/node-config.repository";
import type { EnvService } from "@/config/env/env.service";

type InspectResult = {
	Id: string;
	State: { Running: boolean; ExitCode?: number; StartedAt?: string };
	SizeRw?: number;
	SizeRootFs?: number;
};

function makeMocks(provisioning: "local" | "external" | null = "local") {
	const nodeConfigRepository = {
		find: vi.fn(() =>
			provisioning === null
				? null
				: {
						nodeId: "n1",
						strategy: "local",
						setupState: "setup_done",
						databaseUrl: "postgres://deployer:deployer@127.0.0.1:5432/deployer",
						databaseProvisioning: provisioning,
						configuredAt: "2026-01-01T00:00:00.000Z",
					}),
	} as unknown as NodeConfigRepository;

	const started = vi.fn(async () => ({ id: "pg-1" } as Awaited<ReturnType<PostgresContainerService["startPostgresContainer"]>>));
	const postgresContainerService = {
		startPostgresContainer: started,
	} as unknown as PostgresContainerService;

	const inspectContainer = vi.fn(async (): Promise<InspectResult | null> => ({
		Id: "pg-1",
		State: { Running: true, ExitCode: 0, StartedAt: "2026-01-01T00:00:00.000Z" },
		SizeRw: 12_345,
		SizeRootFs: 98_765,
	}));
	const inspectVolume = vi.fn(async () => ({
		Name: "deployer_postgres_data",
		Mountpoint: "/var/lib/docker/volumes/deployer_postgres_data/_data",
		UsageData: { Size: 4_567_890, RefCount: 1 },
	}));
	const dockerService = {
		getDockerClient: () => ({
			getContainer: vi.fn(() => ({
				inspect: inspectContainer,
			})),
			getVolume: vi.fn(() => ({
				inspect: inspectVolume,
			})),
		}),
	} as unknown as DockerService;

	return { nodeConfigRepository, postgresContainerService, dockerService, started, inspectContainer, inspectVolume };
}

function makeSupervisor(mocks: ReturnType<typeof makeMocks>): GlobalDbSupervisorService {
	const env = {
		get: vi.fn((key: string) => {
			const values: Record<string, unknown> = {
				MANAGED_GLOBAL_DB_ENABLED: false,
			};
			return values[key];
		}),
	} as unknown as EnvService;
	return new GlobalDbSupervisorService(
		mocks.postgresContainerService,
		mocks.dockerService,
		mocks.nodeConfigRepository,
		env,
	);
}

describe("GlobalDbSupervisorService — conditional registration", () => {
	it("registers into the orchestrator when the database is LOCALLY managed", async () => {
		const mocks = makeMocks("local");
		const supervisor = makeSupervisor(mocks);
		const orchestrator = new SupervisorOrchestratorService();
		(supervisor as unknown as { orchestrator: SupervisorOrchestratorService }).orchestrator = orchestrator;

		await supervisor.onModuleInit();

		expect(orchestrator.has(GLOBAL_DB_SUPERVISOR_ID)).toBe(true);
		expect(orchestrator.list().map((s) => s.supervisorId)).toContain(GLOBAL_DB_SUPERVISOR_ID);
	});

	it("does NOT register when the database is externally managed", async () => {
		const mocks = makeMocks("external");
		const supervisor = makeSupervisor(mocks);
		const orchestrator = new SupervisorOrchestratorService();
		(supervisor as unknown as { orchestrator: SupervisorOrchestratorService }).orchestrator = orchestrator;

		await supervisor.onModuleInit();

		expect(orchestrator.has(GLOBAL_DB_SUPERVISOR_ID)).toBe(false);
	});

	it("does NOT register when provisioning is unknown (legacy config)", async () => {
		const mocks = makeMocks(null);
		const supervisor = makeSupervisor(mocks);
		const orchestrator = new SupervisorOrchestratorService();
		(supervisor as unknown as { orchestrator: SupervisorOrchestratorService }).orchestrator = orchestrator;

		await supervisor.onModuleInit();

		expect(orchestrator.has(GLOBAL_DB_SUPERVISOR_ID)).toBe(false);
	});
});

describe("GlobalDbSupervisorService — reconcile", () => {
	it("ensures the managed container runs for a locally-managed database", async () => {
		const mocks = makeMocks("local");
		const supervisor = makeSupervisor(mocks);

		const state = await supervisor.ensureDesiredState();

		expect(state).toBe("converged");
		expect(mocks.started).toHaveBeenCalledTimes(1);
	});

	it("does NOT touch the container for an external database", async () => {
		const mocks = makeMocks("external");
		const supervisor = makeSupervisor(mocks);

		const state = await supervisor.ensureDesiredState();

		expect(state).toBe("converged");
		expect(mocks.started).not.toHaveBeenCalled();
	});
});

describe("GlobalDbSupervisorService — probe / health", () => {
	it("reports healthy with rich measurements for a managed (local) database", async () => {
		const mocks = makeMocks("local");
		const supervisor = makeSupervisor(mocks);
		await supervisor.ensureDesiredState();

		const health = await supervisor.getHealth();

		expect(health.supervisorId).toBe(GLOBAL_DB_SUPERVISOR_ID);
		expect(health.healthy).toBe(true);
		expect(health.detail).toContain("running");
		// Discriminated union resolves to the "managed" branch.
		expect(health.payload.mode).toBe("managed");
		if (health.payload.mode === "managed") {
			expect(health.payload.container).not.toBeNull();
			expect(health.payload.container?.sizeRw).toBe(12_345);
			expect(health.payload.container?.sizeRootFs).toBe(98_765);
			expect(health.payload.volume?.sizeBytes).toBe(4_567_890);
			expect(mocks.inspectVolume).toHaveBeenCalled();
		}
	});

	it("reports unhealthy when the managed container is missing (local DB)", async () => {
		const mocks = makeMocks("local");
		const supervisor = makeSupervisor(mocks);
		await supervisor.ensureDesiredState();
		mocks.inspectContainer.mockResolvedValueOnce(null);

		const health = await supervisor.getHealth();

		expect(health.healthy).toBe(false);
		expect(health.detail).toContain("missing");
		expect(health.payload.mode).toBe("managed");
		if (health.payload.mode === "managed") {
			expect(health.payload.container).toBeNull();
		}
	});

	it("reports unhealthy when the managed container is stopped (local DB)", async () => {
		const mocks = makeMocks("local");
		const supervisor = makeSupervisor(mocks);
		await supervisor.ensureDesiredState();
		mocks.inspectContainer.mockResolvedValueOnce({ Id: "pg-1", State: { Running: false, ExitCode: 1 } });

		const health = await supervisor.getHealth();

		expect(health.healthy).toBe(false);
		expect(health.detail).toContain("not running");
		expect(health.payload.mode).toBe("managed");
		if (health.payload.mode === "managed") {
			expect(health.payload.container?.running).toBe(false);
		}
	});

	it("runs a real SELECT 1 + table listing for an external database (unreachable URL → unhealthy with I/O failure in the payload)", async () => {
		const mocks = makeMocks("external");
		const supervisor = makeSupervisor(mocks);
		await supervisor.ensureDesiredState();

		const health = await supervisor.getHealth();

		// The URL points at a non-listening port — the probe must fail,
		// recording the failure in the discriminated-union payload.
		expect(health.healthy).toBe(false);
		expect(health.payload.mode).toBe("external");
		if (health.payload.mode === "external") {
			expect(health.payload.select1.ok).toBe(false);
			expect(health.payload.tableCount).toBe(0);
			expect(health.payload.database).toBe("deployer");
		}
	});
});

describe("GlobalDbSupervisorService — process info", () => {
	it("reports the managed postgres process + connection DSN via getProcessInfo", async () => {
		const mocks = makeMocks("local");
		const supervisor = makeSupervisor(mocks);

		const info = await supervisor.getProcessInfo();

		expect(info.supervisorId).toBe(GLOBAL_DB_SUPERVISOR_ID);
		expect(info.process.kind).toBe("docker");
		expect(info.process.desired.name).toBe("deployer-postgres-dev");
		expect(info.process.desired.image).toBe("postgres:16-alpine");
		expect(info.process.desired.binds).toContain("deployer_postgres_data:/var/lib/postgresql/data");
		expect(info.process.live.running).toBe(true);
		expect(info.process.live.containerId).toBe("pg-1");
		expect(info.connection.database).toBe("deployer");
		expect(info.connection.host).toBe("127.0.0.1");
		expect(info.connection.port).toBe(5432);
		// Display-safe DSN never leaks the password.
		expect(info.connection.urlSafe).not.toContain(":deployer@");
	});

	it("reports missing container state when the managed container is gone", async () => {
		const mocks = makeMocks("local");
		// Both the health probe AND the process-info inspector see no container.
		mocks.inspectContainer.mockResolvedValue(null);
		const supervisor = makeSupervisor(mocks);

		const info = await supervisor.getProcessInfo();

		expect(info.process.live.running).toBeNull();
		expect(info.process.live.containerId).toBeNull();
		expect(info.connection.database).toBe("deployer");
	});
});