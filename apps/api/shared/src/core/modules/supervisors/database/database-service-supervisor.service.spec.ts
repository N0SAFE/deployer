import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { DockerEngineShape } from "@deployer/docker";
import { SupervisorOrchestratorService } from "../../supervision/index";

import type { EnvService } from "../../../../config/env/env.module";
import { DATABASE_SERVICE_SUPERVISOR_ID, DatabaseServiceSupervisorService } from "./database-service-supervisor.service";

/**
 * The host's job is wiring and the registration decision: the `MANAGED_DATABASE_*` environment reaches
 * the Effect supervisor, and the supervisor registers only when it owns the instances. The supervisor's
 * own behaviour is tested in `@deployer/platform-supervisors`.
 */
function makeSupervisor(values: Record<string, unknown>) {
	const reconciled: string[] = [];
	const engine = {
		swarmCluster: { isActive: () => Effect.succeed(true) },
		networks: { ensureOverlay: () => Effect.void },
		volumes: { ensure: () => Effect.void },
		swarmServices: {
			reconcile: (spec: { name: string }) => Effect.sync(() => { reconciled.push(spec.name); }),
			inspect: (name: string) => Effect.succeed({ ID: `svc-${name}`, CreatedAt: "", UpdatedAt: "", Spec: { Name: name } }),
			listTasks: () => Effect.succeed([{ Status: { State: "running" } }]),
		},
	};
	const env = { get: vi.fn((key: string) => values[key]) } as unknown as EnvService;
	const supervisor = new DatabaseServiceSupervisorService(engine as unknown as DockerEngineShape, env);
	const orchestrator = new SupervisorOrchestratorService();
	(supervisor as unknown as { orchestrator: SupervisorOrchestratorService }).orchestrator = orchestrator;
	return { supervisor, orchestrator, reconciled };
}

describe("DatabaseServiceSupervisorService (host)", () => {
	it("registers and converges the instances named in MANAGED_DATABASE_INSTANCES, trimmed and deduplicated", async () => {
		const { supervisor, orchestrator, reconciled } = makeSupervisor({ MANAGED_DATABASE_INSTANCES: " db-a, db-b ,db-a," });
		supervisor.onModuleInit();
		expect(orchestrator.has(DATABASE_SERVICE_SUPERVISOR_ID)).toBe(true);

		expect(await supervisor.ensureDesiredState()).toBe("converged");
		expect(reconciled.sort()).toEqual(["deployer-database-db-a", "deployer-database-db-b"]);
	});

	it("does not register when the deployment owns the instances", () => {
		const { supervisor, orchestrator } = makeSupervisor({ MANAGED_DATABASE_ENABLED: "true", MANAGED_DATABASE_INSTANCES: "db-a" });
		supervisor.onModuleInit();
		expect(orchestrator.has(DATABASE_SERVICE_SUPERVISOR_ID)).toBe(false);
	});

	it("does not register when no instance is configured", () => {
		const { supervisor, orchestrator } = makeSupervisor({});
		supervisor.onModuleInit();
		expect(orchestrator.has(DATABASE_SERVICE_SUPERVISOR_ID)).toBe(false);
	});
});
