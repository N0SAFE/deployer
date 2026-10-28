/**
 * The Nest host for `@deployer/supervision`: base classes supervisors extend, the orchestrator and
 * event bus as injectable providers, and the module that wires them. The framework itself (lifecycle,
 * registry, drift control) is the Effect package; nothing here decides how supervision works.
 */
export { BaseSupervisorService } from "./base-supervisor.service";
export type { SupervisorHealthSnapshot, SupervisorProbeResult } from "./base-supervisor.service";
export { BaseMultiSupervisorService } from "./base-multi-supervisor.service";
export type { AnyChildSupervisor } from "./base-multi-supervisor.service";
export { SupervisorEventBus } from "./supervisor-event.bus";
export { SupervisorOrchestratorService } from "./supervisor-orchestrator.service";
export type { AnySupervisor } from "./supervisor-orchestrator.service";
export { SupervisorsModule } from "./supervisors.module";
