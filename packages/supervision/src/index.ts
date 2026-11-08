/**
 * @deployer/supervision — desired-state supervision as Effect.
 *
 * A supervisor is a `SupervisorSpec` (how to converge a resource, how to probe it, what the probe
 * reports); `makeSupervisor` gives it a lifecycle; the `SupervisorOrchestrator` registers them,
 * converges them at boot and keeps correcting drift. Nothing here knows what is supervised or how it
 * is hosted; Nest apps mount it through `@deployer/nest-effect`.
 */
export {
    baseSupervisorPayloadSchema,
    supervisorProbeMetaSchema,
} from './schemas/probe'
export type {
    BaseSupervisorPayload,
    SupervisorProbeMeta,
} from './schemas/probe'
export {
    baseSupervisorProcessInfoSchema,
    dockerProcessInfoSchema,
    sqliteProcessInfoSchema,
    swarmProcessInfoSchema,
} from './schemas/process-info'
export type {
    BaseSupervisorProcessInfo,
    DockerProcessInfo,
    SwarmProcessInfo,
} from './schemas/process-info'

export type { SupervisorState } from './supervisor/state'
export type {
    HealthSnapshot,
    ProbeResult,
    SupervisorSpec,
} from './supervisor/spec'
export { supervisorIdentifier } from './supervisor/identifier'
export type { SupervisorIdentifierInput } from './supervisor/identifier'
export { withBackoff } from './supervisor/backoff'
export type { BackoffOptions } from './supervisor/backoff'
export { makeSupervisor } from './supervisor/supervisor'
export type {
    AnySupervisor,
    MakeSupervisorOptions,
    Supervisor,
} from './supervisor/supervisor'

export { SupervisorEventBus } from './events/event-bus'
export type { SupervisorEventBusShape } from './events/event-bus'
export { matchesEventFilter } from './events/supervisor-event'
export type {
    SupervisorEvent,
    SupervisorEventFilter,
    SupervisorEventType,
} from './events/supervisor-event'

export {
    SupervisorRegistry,
    DEFAULT_REGISTRATION_WAIT_MS,
} from './orchestration/registry'
export type { SupervisorRegistryShape } from './orchestration/registry'
export {
    DEGRADED_RETRY_INTERVAL_MS,
    RECONCILE_SWEEP_INTERVAL_MS,
} from './orchestration/drift-control'
export {
    SupervisorOrchestrator,
} from './orchestration/orchestrator'
export type { SupervisorOrchestratorShape } from './orchestration/orchestrator'
