import { Effect } from "effect";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { PostgresProvisionerShape } from "@deployer/docker";
import { runPromiseUnwrapped } from "@deployer/effect-core";
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

/** The flow is an Effect failing with a tagged refusal; the matrix asserts on the refusal's message, so run it unwrapped. */
const run = <A, E>(effect: Effect.Effect<A, E>) => runPromiseUnwrapped(effect);

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
/**
 * THE FOUNDING MATRIX: database source × who owns the platform services × swarm role × engine outcome.
 *
 * Rules pinned here (see `initialize`): the swarm is founded ONLY for a locally-provisioned database on a deployment
 * that does not own every service; it is founded BEFORE the database; the operator's swarm choice is persisted BEFORE it
 * is acted on; a swarm that does not come up stops the run before any database exists and before `setup_done`.
 */
type Source = "explicit" | "provided" | "provision";
type Owner = "deployment owns everything" | "platform owns services";
const OWNED_ENV = { MANAGED_TRAEFIK_ENABLED: "true", MANAGED_REDIS_ENABLED: "true", MANAGED_LOCAL_DB_ENABLED: "true" };

function makeMatrixService(options: { source: Source; owner: Owner; snapshotState?: string; migrationsFail?: boolean }) {
	const timeline: string[] = [];
	const rows: Record<string, unknown>[] = [];
	let stored: Record<string, unknown> | null =
		options.source === "provided" ? { nodeId: "n", strategy: "local", setupState: "not_started", databaseUrl: EXTERNAL_URL, databaseProvisioning: "external" } : null;
	const repo = {
		find: () => Effect.succeed(stored),
		upsert: (row: Record<string, unknown>) => {
			timeline.push(row.setupState === "setup_done" ? "persist:setup_done" : "persist:swarm-choice");
			stored = { ...(stored ?? {}), ...row };
			rows.push(row);
			return Effect.succeed(row);
		},
	} as unknown as NodeConfigRepositoryShape;
	const flags: Record<string, string> = options.owner === "deployment owns everything" ? OWNED_ENV : {};
	const env = { get: (key: string) => (key === "DEPLOYER_PREFIX" ? "" : key === "DB_DATABASE" ? "deployer" : flags[key]) } as unknown as EnvService;
	const service = makeLocalInitializationService({
		postgresProvisioner: { ensure: vi.fn(() => Effect.succeed({ name: "pg" })) } as unknown as PostgresProvisionerShape,
		dockerEngine: { swarmServices: { logs: vi.fn(() => Effect.succeed("")) } } as unknown as DockerEngineShape,
		env,
		nodeConfigRepository: repo,
		swarmBootstrap: { converge: () => (timeline.push("swarm:converge"), Effect.void) } as unknown as SwarmBootstrapShape,
		swarmCluster: {
			getLocalClusterSnapshot: () =>
				Effect.succeed({ localNodeState: options.snapshotState ?? "active", nodeCount: 1, managerCount: 1, localNode: { swarmRole: "manager" }, master: { nodeId: "self" } }) as never,
		} as unknown as SwarmClusterShape,
		supervisors: { convergeNow: () => Effect.succeed(null) } as unknown as SupervisorOrchestratorShape,
		// The DB-heavy steps are the factory's overridable ports: each records its place on the timeline.
		steps: {
			provisionDockerDatabase: () => (timeline.push("database:provision"), Promise.resolve(LOCAL_URL)),
			probeExistingDatabase: () => (timeline.push("database:probe"), Promise.resolve(EXTERNAL_URL)),
			ensureDatabaseEmpty: () => Promise.resolve([]),
			runMigrations: () => (timeline.push("database:migrate"), options.migrationsFail === true ? Promise.reject(new Error("migration failed")) : Promise.resolve()),
			seedInitialData: () => (timeline.push("database:seed"), Promise.resolve({ userId: "u1" })),
		},
	});
	return { service, timeline, rows };
}

const sources: Source[] = ["explicit", "provided", "provision"];
const owners: Owner[] = ["deployment owns everything", "platform owns services"];
const policies = [{ mode: "create", policy: "auto", joinAddrs: [] }, { mode: "create", policy: "manager", joinAddrs: [] }, undefined] as const;
const base = { strategy: "local" as const, name: "Admin", email: "admin@test.com", password: "password123", serverUrl: "http://127.0.0.1:3001" };

describe.each(sources.flatMap((source) => owners.flatMap((owner) => policies.map((swarm) => [`${source} db · ${owner} · ${swarm?.policy ?? "no swarm choice"}`, source, owner, swarm] as const))))(
	"founding matrix · %s",
	(_name, source, owner, swarm) => {
		const input = { ...base, ...(source === "explicit" ? { existingDatabaseUrl: EXTERNAL_URL } : {}), ...(swarm ? { swarm } : {}) } as never;
		const foundsSwarm = source === "provision" && owner === "platform owns services";

		it("founds the swarm only when it must, always before the database, and ends setup_done with the right marker", async () => {
			const { service, timeline, rows } = makeMatrixService({ source, owner });
			await run(service.initialize(input, new SetupStepTracker(), noopEmit));

			expect(timeline.includes("swarm:converge")).toBe(foundsSwarm);
			if (foundsSwarm) {
				// Decision persisted, THEN acted on, THEN the database.
				expect(timeline.indexOf("persist:swarm-choice")).toBeLessThan(timeline.indexOf("swarm:converge"));
				expect(timeline.indexOf("swarm:converge")).toBeLessThan(timeline.indexOf("database:provision"));
			}
			expect(timeline.indexOf("database:migrate")).toBeLessThan(timeline.indexOf("persist:setup_done"));
			const final = rows.at(-1) as { setupState: string; databaseProvisioning: string; swarmConfig?: { policy: string }; meshSharedSecret?: string };
			expect(final.setupState).toBe("setup_done");
			expect(final.databaseProvisioning).toBe(source === "provision" ? "local" : "external");
			expect(final.meshSharedSecret).toBeTruthy();
			// What the operator chose is what is stored, not a default.
			expect(final.swarmConfig?.policy).toBe(swarm?.policy);
		});

		it("a failing migration never produces setup_done", async () => {
			const { service, rows } = makeMatrixService({ source, owner, migrationsFail: true });
			await expect(run(service.initialize(input, new SetupStepTracker(), noopEmit))).rejects.toThrow();
			expect(rows.some((row) => row.setupState === "setup_done")).toBe(false);
		});

		if (foundsSwarm) {
			it("a swarm that never becomes active stops the run: no database, no setup_done", async () => {
				const { service, timeline, rows } = makeMatrixService({ source, owner, snapshotState: "inactive" });
				await expect(run(service.initialize(input, new SetupStepTracker(), noopEmit))).rejects.toThrow(/did not become active/);
				expect(timeline).not.toContain("database:provision");
				expect(rows.some((row) => row.setupState === "setup_done")).toBe(false);
			});
		}
	},
);
