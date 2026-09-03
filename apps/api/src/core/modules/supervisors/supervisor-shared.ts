/**
 * supervisor-shared.ts — PROCESS-WIDE supervisor singletons.
 *
 * The API boots MULTIPLE NestJS applications in the SAME process: the gateway
 * app (main.ts → OrchestrationModule) and the sub-apps it orchestrates
 * (setup-wizard, mesh-initializer, main app). The platform supervisors
 * (Traefik ingress, failover proxy, local/global DB) MUST run BEFORE and
 * WHILE the setup wizard runs — they are the only way into the platform now
 * that docker-compose publishes no service ports. So they are owned by the
 * GATEWAY app (boots first) and stay alive for the whole process.
 *
 * The main sub-app (AppModule) still needs the same registry + event bus for
 * health aggregation and supervisor accessors — WITHOUT booting a second copy
 * of any supervisor. These module-level singletons make that possible:
 * `SupervisorsModule` provides `SupervisorOrchestratorService` +
 * `SupervisorEventBus` backed by them, so every bootstrapped app shares one
 * registry and one bus.
 *
 * Direct construction (`new SupervisorOrchestratorService()` — unit tests)
 * never touches these — the class falls back to an isolated map.
 */

import { SupervisorEventBus } from "./supervisor-event.bus";
import type { AnySupervisor } from "./supervisor-orchestrator.service";

let sharedRegistry: Map<string, AnySupervisor> | undefined;
let sharedBus: SupervisorEventBus | undefined;

/** The process-wide supervisor registry (created once, shared by DI). */
export function getSharedSupervisorRegistry(): Map<string, AnySupervisor> {
	sharedRegistry ??= new Map<string, AnySupervisor>();
	return sharedRegistry;
}

/** The process-wide supervisor event bus (created once, shared by DI). */
export function getSharedSupervisorEventBus(): SupervisorEventBus {
	sharedBus ??= new SupervisorEventBus();
	return sharedBus;
}