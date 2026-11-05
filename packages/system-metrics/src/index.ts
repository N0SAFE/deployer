/**
 * @deployer/system-metrics — this machine's readings as Effect.
 *
 * Framework-free: a Nest app provides the `SystemMetrics` tag from `makeSystemMetrics`.
 */
export { MetricsUnavailable } from './errors'
export { systeminformationProbe } from './probe'
export type { MachineProbe } from './probe'
export type { Readings } from './readings'
export { toSnapshot } from './snapshot'
export {
    DEFAULT_SNAPSHOT_TTL_MS,
    makeSystemMetrics,
    SystemMetrics,
} from './system-metrics'
export type { SystemMetricsOptions, SystemMetricsShape } from './system-metrics'
