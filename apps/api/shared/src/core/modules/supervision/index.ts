/**
 * Supervision in Nest: the module that provides the `SupervisorOrchestrator` Effect service and the RxJS
 * event bus (the observability surface), and the helpers a module uses to register its supervisors.
 * The framework itself (lifecycle, registry, drift control) is `@deployer/supervision`.
 */
export {
    makeSupervisorEventBusFacade,
    SupervisorEventBus,
    type SupervisorEventBusFacade,
} from './supervisor-event.bus'
export { SupervisorsModule } from './supervisors.module'
export {
    buildSupervisor,
    makeSupervisorRegistrar,
    supervisorProviders,
} from './supervisor-registration'
export type { SupervisorRegistration } from './supervisor-registration'
