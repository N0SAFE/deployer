import { describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import {
	GlobalDbSupervisorService,
	GLOBAL_DB_SUPERVISOR_ID,
} from "./global-db-supervisor.service";
import { SupervisorOrchestratorService } from "@/core/modules/supervisors/supervisor-orchestrator.service";
import type { DockerService } from "@/core/modules/docker/services/docker.service";
import type { PostgresServiceProvisioner } from "@/core/modules/docker/containers/postgres/postgres-service.provisioner";
import type { NodeConfigRepository } from "@/core/modules/setup/repositories/node-config.repository";
import type { EnvService } from "@repo/nest-env";

type InspectResult = {
	Id: string;
	State: { Running: boolean; ExitCode?: number; StartedAt?: string };
	SizeRw?: number;
	SizeRootFs?: number;
};

function makeMocks(provisioning: "local" | "external" | null = "local") {
	// Port 1 is never open: the "unreachable" probe test must not depend on the
	// host's 5432 being free (the managed Postgres container publishes exactly
	// that port, so using it made the fixture flap between runs).
	const nodeConfigRepository = {
		find: vi.fn(() =>
			provisioning === null
				? null
				: {
						nodeId: "n1",
						strategy: "local",
						setupState: "setup_done",
						databaseUrl: "postgres://deployer:deployer@127.0.0.1:1/deployer",
						databaseProvisioning: provisioning,
						configuredAt: "2026-01-01T00:00:00.000Z",
					}),
	} as unknown as NodeConfigRepository;

	const startPostgresContainer = vi.fn(async () => ({ id: "pg-1" }));
	const provisioner = {
		buildSpec: vi.fn(() => ({
			name: "deployer-postgres",
			image: "postgres:16-alpine",
			mode: "replicated" as const,
			replicas: 1,
			env: [],
			command: [],
			args: [],
			labels: {},
			containerLabels: {},
			mounts: [],
			placementPreferences: [],
			placementConstraints: [],
			resourcesLimits: {},
			resourcesReservations: {},
			networks: [],
			healthcheck: null,
			updateConfig: { parallelism: 1, delayMs: 0, order: "start-first" as const, failureAction: "rollback" as const },
			endpointPorts: [],
			stopGracePeriodSeconds: 60,
		})),
		attachOverlay: vi.fn((spec: unknown) => spec),
		ensureOverlay: vi.fn(async () => "deployer-platform-overlay"),
	} as unknown as PostgresServiceProvisioner;

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
				remove: vi.fn(async () => undefined),
			})),
			getVolume: vi.fn(() => ({
				inspect: inspectVolume,
			})),
		}),
		getSwarmInfo: async () => ({
			NodeID: "n1",
			NodeAddr: "",
			LocalNodeState: "active",
			ControlAvailable: true,
			Error: "",
			RemoteManagers: null,
			Nodes: 1,
			Managers: 1,
		}),
		inspectSwarmService: vi.fn(async () => ({ ID: "svc-1", Version: { Index: 1 }, Spec: { Name: "deployer-postgres" } })),
		createSwarmService: vi.fn(async () => ({ ID: "svc-1" })),
		updateSwarmService: vi.fn(async () => undefined),
		removeSwarmService: vi.fn(async () => undefined),
		ensureOverlayNetwork: vi.fn(async () => "net-id"),
		listSwarmServiceTasks: vi.fn(async () => [{ Status: { State: "running" } }]),
	} as unknown as DockerService;

	return { nodeConfigRepository, provisioner, dockerService, startPostgresContainer, inspectContainer, inspectVolume };
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
		mocks.dockerService,
		mocks.provisioner,
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
	it("ensures the swarm service runs for a locally-managed database", async () => {
		const mocks = makeMocks("local");
		const supervisor = makeSupervisor(mocks);

		const state = await supervisor.ensureDesiredState();

		expect(state).toBe("converged");
		// Swarm path: inspectSwarmService → reconcileSwarmService → updateSwarmService
		expect(mocks.dockerService.inspectSwarmService).toHaveBeenCalled();
	});

	it("does NOT touch the container for an external database", async () => {
		const mocks = makeMocks("external");
		const supervisor = makeSupervisor(mocks);

		const state = await supervisor.ensureDesiredState();

		expect(state).toBe("converged");
		expect(mocks.startPostgresContainer).not.toHaveBeenCalled();
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
			expect(health.payload.service).not.toBeNull();
			expect(health.payload.service?.runningTasks).toBe(1);
			expect(health.payload.volume?.sizeBytes).toBe(4_567_890);
			expect(mocks.inspectVolume).toHaveBeenCalled();
		}
	});

	it("reports unhealthy when the managed swarm service is missing (local DB)", async () => {
		const mocks = makeMocks("local");
		const supervisor = makeSupervisor(mocks);
		await supervisor.ensureDesiredState();
		(mocks.dockerService.inspectSwarmService as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new NotFoundException("service not found"),
		);

		const health = await supervisor.getHealth();

		expect(health.healthy).toBe(false);
		expect(health.detail).toContain("missing");
		expect(health.payload.mode).toBe("managed");
		if (health.payload.mode === "managed") {
			expect(health.payload.service).toBeNull();
		}
	});

	it("reports unhealthy when the managed swarm service has no running task (local DB)", async () => {
		const mocks = makeMocks("local");
		const supervisor = makeSupervisor(mocks);
		await supervisor.ensureDesiredState();
		(mocks.dockerService.listSwarmServiceTasks as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
			{ Status: { State: "pending" } },
		]);

		const health = await supervisor.getHealth();

		expect(health.healthy).toBe(false);
		expect(health.detail).toContain("no running task");
		expect(health.payload.mode).toBe("managed");
		if (health.payload.mode === "managed") {
			expect(health.payload.service?.runningTasks).toBe(0);
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
		expect(info.process.kind).toBe("swarm");
		expect(info.process.desired.name).toBe("deployer-postgres");
		expect(info.process.desired.image).toBe("postgres:16-alpine");
		expect(info.process.desired.mode).toBe("replicated");
		expect(info.process.live.exists).toBe(true);
		expect(info.process.live.serviceId).toBe("svc-1");
		expect(info.connection.database).toBe("deployer");
		expect(info.connection.host).toBe("127.0.0.1");
		expect(info.connection.port).toBe(1);
		// Display-safe DSN never leaks the password.
		expect(info.connection.urlSafe).not.toContain(":deployer@");
	});

	it("reports missing service state when the managed swarm service is gone", async () => {
		const mocks = makeMocks("local");
		// Both the health probe AND the process-info inspector see no service.
		(mocks.dockerService.inspectSwarmService as ReturnType<typeof vi.fn>).mockRejectedValue(
			new NotFoundException("service not found"),
		);
		const supervisor = makeSupervisor(mocks);

		const info = await supervisor.getProcessInfo();

		expect(info.process.live.exists).toBe(false);
		expect(info.process.live.serviceId).toBeNull();
		expect(info.connection.database).toBe("deployer");
	});
});