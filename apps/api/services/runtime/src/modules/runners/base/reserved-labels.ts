import { RuntimeInvalid } from '../../../core/runtime.errors'

/**
 * Platform-owned label namespaces. A deployment's executor labels must never write them: they carry the
 * managed markers the deployment service reads back (`deployer.managed`, `deployer.service_id`, …) and the
 * Traefik routing the platform generates. Letting a user set them spoofs platform state or hijacks routing.
 */
const RESERVED_LABEL_PREFIXES = ['deployer.', 'traefik.'] as const

/** Refuses a reserved label with a typed error; the runner reports it like any other invalid executor option. */
export function assertExecutorLabelAllowed(key: string): void {
    const normalized = key.trim().toLowerCase()
    const prefix = RESERVED_LABEL_PREFIXES.find((candidate) =>
        normalized.startsWith(candidate)
    )
    if (prefix !== undefined) {
        throw new RuntimeInvalid({
            reason: `Executor label '${key}' is reserved by the platform (prefix '${prefix}') and cannot be set by a deployment`,
        })
    }
}
