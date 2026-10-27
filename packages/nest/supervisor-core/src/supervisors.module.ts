/**
 * SupervisorsModule — the global home of the supervisor FRAMEWORK.
 *
 * Exports `SupervisorOrchestratorService` globally so that:
 *   - supervisor classes anywhere can self-register via constructor injection,
 *   - the health module can aggregate health without import wiring.
 *
 * A LEAF on purpose (no heavy imports), so a module that imports it — including a unit-test
 * harness — does not drag in Docker / Env / Platform. Concrete supervisor implementations are
 * registered by the folder-scoped modules beside it:
 *
 *   - `SupervisorsDatabaseModule`  → database/ (global Postgres + local SQLite)
 *   - `SupervisorsPlatformModule`  → platform/ (Traefik, managed web, redis, edge connector)
 */

import { Global, Module, type DynamicModule } from "@nestjs/common";

import { SupervisorOrchestratorService } from "./supervisor-orchestrator.service";
import { SupervisorEventBus } from "./supervisor-event.bus";

@Global()
@Module({})
export class SupervisorsModule {
	static forRoot(): DynamicModule {
		return {
			module: SupervisorsModule,
			// ── WHY THE REGISTRY IS PER-CONTAINER, NOT PROCESS-WIDE ──────────────
			// It used to come from `supervisor-shared.ts`, so every Nest application booted in
			// the process shared ONE registry. That existed for a model this tree no longer has:
			// a gateway app spawning setup-wizard / mesh-initializer / main SUB-APPS, which had
			// to observe the gateway's supervisors without booting their own. `main.ts` states
			// the current shape — "ONE graph (AppModule): there is no sub-app pipeline" — so the
			// only thing the shared singleton still did was make a SECOND boot collide:
			//
			//   Duplicate supervisorId "platform-managed-web" registered by both
			//   ManagedWebSupervisorService and ManagedWebSupervisorService
			//
			// The ids match but the instances do not, because each container instantiates its own
			// providers. Scoping the registry to the module gives each application its own
			// supervisors — which is what a Nest module is supposed to mean — and makes booting
			// the same app twice (an e2e suite running several nodes) work instead of throwing.
			providers: [
				SupervisorEventBus,
				SupervisorOrchestratorService,
			],
			exports: [SupervisorOrchestratorService, SupervisorEventBus],
		};
	}
}
