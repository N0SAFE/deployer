/**
 * @repo/nest-supervisor-core — the supervisor FRAMEWORK.
 *
 * WHAT THIS PACKAGE IS
 * The primitives any supervised resource is built from:
 *   - `BaseSupervisorService`     — converge/probe lifecycle, backoff, events
 *   - `BaseMultiSupervisorService` — a supervisor owning N keyed instances
 *   - `SupervisorOrchestratorService` — registry + boot convergence
 *   - `SupervisorEventBus`        — RxJS pub/sub for lifecycle + health events
 *   - the payload/process-info schemas, and the process-wide registry singletons
 *
 * WHY IT IS ITS OWN PACKAGE (and why that matters for the DI graph)
 * `docker` imports this framework, and the concrete supervisor implementations
 * (`supervisors/platform/*`, `supervisors/database/*`) import `docker`. That is
 * a cycle ONLY between docker and the IMPLEMENTATIONS — the framework itself
 * has no docker dependency, so extracting it breaks the cycle. Keeping the
 * framework and the implementations in one package would have made both
 * unextractable.
 *
 * WHAT IT IS NOT
 * No concrete supervisor lives here: this package knows how to supervise, never
 * WHAT to supervise. The resources (traefik, redis, postgres, the failover
 * proxy) are the app's concern.
 */
export {
	BaseSupervisorService,
	baseSupervisorPayloadSchema,
} from "./base-supervisor.service";
export type {
	BaseSupervisorPayload,
	SupervisorProbeResult,
	SupervisorHealthSnapshot,
	SupervisorState,
	BackoffOptions,
} from "./base-supervisor.service";

export { BaseMultiSupervisorService } from "./base-multi-supervisor.service";
export { SupervisorEventBus } from "./supervisor-event.bus";
export type { SupervisorEvent, SupervisorEventType, SupervisorEventFilter } from "./supervisor-event.bus";
export { SupervisorOrchestratorService } from "./supervisor-orchestrator.service";
export type { AnySupervisor } from "./supervisor-orchestrator.service";
export { baseSupervisorProcessInfoSchema, swarmProcessInfoSchema } from "./supervisor-process-info";
export { getSharedSupervisorEventBus, getSharedSupervisorRegistry } from "./supervisor-shared";
export { SupervisorsModule } from "./supervisors.module";
