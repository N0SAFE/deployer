export {
    PreflightDependency,
    formatPreflightReport,
    type CheckContext,
    type CheckOutcome,
    type CheckResult,
    type PreflightCheck,
    type PreflightReport,
} from './types'
export {
    DEFAULT_CHECK_TIMEOUT_MS,
    PREFLIGHT_CHECKS,
    checkDatabase,
    checkMigrations,
    checkRedis,
    skipped,
} from './checks'
export {
    REPORT_ONLY,
    WAIT_FOR_DEPENDENCIES,
    runPreflight,
    type PreflightPolicy,
} from './runner'
export {
    DEPENDENCIES,
    makePreflightService,
    PreflightService,
    type PreflightServiceShape,
} from './preflight.service'
export { PreflightModule } from './preflight.module'
