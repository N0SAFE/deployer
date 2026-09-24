/**
 * SupervisorsModule — global home of the supervisor FRAMEWORK.
 *
 * Exports the SupervisorOrchestratorService globally so that:
 *   - supervisor classes anywhere can self-register via constructor injection,
 *   - the health module can aggregate health without import wiring.
 *
 * This module is deliberately a LEAF (no heavy imports) so any module that
 * imports it — including unit-test harnesses — does not pull in Docker / Env /
 * Platform dependencies. Concrete supervisor implementations are registered by
 * folder-scoped modules in the same directory:
 *
 *   - `SupervisorsDatabaseModule`  → database/ (global Postgres + local SQLite)
 *   - `SupervisorsPlatformModule`  → platform/ (Traefik + managed web)
 *
 * Of those, ONLY the gateway app (main.ts → OrchestrationModule) imports the
 * concrete modules — the supervisors must be alive BEFORE and WHILE the setup
 * wizard runs (the only way into the platform now that no service ports are
 * published). Sub-apps import nothing but this framework module.
 *
 * Both providers are backed by the PROCESS-WIDE singletons in
 * `supervisor-shared.ts`: every bootstrapped app (gateway + main sub-app)
 * shares ONE registry + ONE event bus, so the sub-app's health aggregation
 * observes the gateway-owned supervisors without booting a second copy.
 */

import { Global, Module, type DynamicModule } from "@nestjs/common";

import { SupervisorOrchestratorService } from "./supervisor-orchestrator.service";
import { SupervisorEventBus } from "./supervisor-event.bus";
import { getSharedSupervisorEventBus, getSharedSupervisorRegistry } from "./supervisor-shared";

/**
 * SupervisorsModule — global home of the supervisor FRAMEWORK.
 *
 * REGISTER WITH `forRoot()`, NOT A BARE IMPORT.
 * It takes no options: the framework is process-wide and its two providers come
 * from the shared singletons below, so there is nothing to configure. The
 * method exists so EVERY shared NestJS module in this repo is registered the
 * same way (`DockerModule.forRoot(…)`, `SwarmModule.forRootAsync(…)`,
 * `NodesModule.forRoot()`, …). A mixed vocabulary — some packages imported
 * directly and others configured — is what makes a wiring mistake hard to spot.
 *
 * Concrete supervisor implementations are registered by folder-scoped modules
 * in the app:
 *   - database supervisors (global Postgres + local SQLite)
 *   - platform supervisors (Traefik, managed web, redis, WireGuard)
 *
 * Of those, ONLY the gateway app imports the concrete modules — the supervisors
 * must be alive BEFORE and WHILE the setup wizard runs (the only way into the
 * platform now that no service ports are published). Sub-apps import nothing but
 * this framework module.
 *
 * Both providers are backed by the PROCESS-WIDE singletons in
 * `supervisor-shared.ts`: every bootstrapped app (gateway + main sub-app)
 * shares ONE registry + ONE event bus, so the sub-app's health aggregation
 * observes the gateway-owned supervisors without booting a second copy.
 */
@Global()
@Module({})
export class SupervisorsModule {
	static forRoot(): DynamicModule {
		return {
			module: SupervisorsModule,
			providers: [
				{ provide: SupervisorEventBus, useFactory: getSharedSupervisorEventBus },
				{
					provide: SupervisorOrchestratorService,
					useFactory: () => new SupervisorOrchestratorService(getSharedSupervisorRegistry()),
				},
			],
			exports: [SupervisorOrchestratorService, SupervisorEventBus],
		};
	}
}
