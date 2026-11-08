import { Context, Effect } from 'effect'

import type { DatabasePort, StorageFailure } from '../../database/storage'
import {
    ServiceDomainMappingRepository,
    type ServiceDomainMappingRepositoryShape,
} from '../repositories/service-domain-mapping.repository'

import type {
    SubdomainAvailabilityResult,
    SubdomainValidationResult,
    BasePathValidationResult,
} from '../interfaces'

export type DomainConflictServiceShape = {
    /** Whether a subdomain + base path combination is free on a project domain. */
    readonly checkSubdomainAvailability: (
        projectDomainId: string,
        subdomain: string | null,
        basePath: string | null,
        excludeServiceId?: string
    ) => Effect.Effect<
        SubdomainAvailabilityResult,
        StorageFailure,
        ServiceDomainMappingRepository
        | ServiceDomainMappingRepositoryShape
        | DatabasePort
    >
}

const COMMON_BASE_PATHS = [
    '/v1',
    '/v2',
    '/v3',
    '/api',
    '/app',
    '/web',
    '/admin',
    '/dashboard',
]

const generateAvailableBasePaths = (usedPaths: string[]): string[] =>
    COMMON_BASE_PATHS.filter((path) => !usedPaths.includes(path))

/** URL for display; the domain is resolved later. */
const computePlaceholderUrl = (
    subdomain: string | null,
    basePath: string | null
): string =>
    `https://${subdomain ? `${subdomain}.` : ''}{domain}${basePath ?? ''}`

/**
 * The availability decision: exact match wins, then a bare subdomain already taken at the root, then a
 * subdomain shared over other base paths, else free. Pure, so it takes the rows it judged.
 */
const decideAvailability = (
    existing: readonly {
        serviceId: string
        serviceName: string
        subdomain: string | null
        basePath: string | null
    }[],
    basePath: string | null
): SubdomainAvailabilityResult => {
    const conflicts = existing.map((m) => ({
        ...m,
        fullUrl: computePlaceholderUrl(m.subdomain, m.basePath),
    }))
    const usedBasePaths = existing
        .map((m) => m.basePath)
        .filter((path): path is string => path !== null)

    if (existing.some((m) => m.basePath === basePath))
        return {
            available: false,
            conflicts,
            suggestions: {
                availableBasePaths: [],
                message:
                    'This exact URL is already in use. Please choose a different subdomain or base path.',
            },
        }
    if (!basePath && existing.some((m) => !m.basePath))
        return {
            available: false,
            conflicts,
            suggestions: {
                availableBasePaths: generateAvailableBasePaths(usedBasePaths),
                message:
                    'This subdomain is already used without a base path. Add a base path to differentiate your service.',
            },
        }
    if (existing.length > 0)
        return {
            available: true,
            conflicts,
            suggestions: {
                availableBasePaths: generateAvailableBasePaths(usedBasePaths),
                message: `This subdomain is shared with ${String(existing.length)} other service(s) using different base paths.`,
            },
        }
    return {
        available: true,
        conflicts: [],
        suggestions: {
            availableBasePaths: [],
            message: 'This subdomain is available.',
        },
    }
}

/** Multi-level subdomains ('v2.staging.api') are validated label by label (DNS rules). Pure, so not part of the service's Effect shape. */
export function validateSubdomain(
    subdomain: string
): SubdomainValidationResult {
    if (!subdomain) return { valid: true } // null/empty is valid (root domain)

    const labelRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i
    for (const label of subdomain.split('.')) {
        if (label.length === 0)
            return {
                valid: false,
                error: 'Subdomain cannot have empty labels (consecutive dots)',
            }
        if (label.length > 63)
            return {
                valid: false,
                error: `Each subdomain label must be 63 characters or less (found: "${label}")`,
            }
        if (!labelRegex.test(label)) {
            return {
                valid: false,
                error: `Label "${label}" must start and end with alphanumeric characters, and can contain hyphens`,
            }
        }
    }
    if (subdomain.length > 253)
        return {
            valid: false,
            error: 'Total subdomain must be 253 characters or less',
        }
    return { valid: true }
}

/** Pure. */
export function validateBasePath(basePath: string): BasePathValidationResult {
    if (!basePath) return { valid: true } // null/empty is valid (root path)
    if (!basePath.startsWith('/'))
        return { valid: false, error: 'Base path must start with /' }
    if (basePath.length > 255)
        return {
            valid: false,
            error: 'Base path must be 255 characters or less',
        }
    if (basePath !== '/' && basePath.endsWith('/'))
        return { valid: false, error: 'Base path should not end with /' }
    return { valid: true }
}

/**
 * Tag and implementation together: the tag is the contract, `live` the one implementation.
 *
 * The availability decision reads the mapping table through its repository, yielded when the operation
 * runs — the requirement channel says so, so a spec provides the repository and nothing else.
 */
export class DomainConflictService extends Context.Service<
    DomainConflictService,
    DomainConflictServiceShape
>()('shared/DomainConflictService') {
    static readonly live = class DomainConflictServiceImpl
        implements DomainConflictServiceShape
    {
        checkSubdomainAvailability(
            projectDomainId: string,
            subdomain: string | null,
            basePath: string | null,
            excludeServiceId?: string
        ): ReturnType<
            DomainConflictServiceShape['checkSubdomainAvailability']
        > {
            return Effect.gen(function* () {
                const mappings = yield* ServiceDomainMappingRepository
                const existing =
                    yield* mappings.findByProjectDomainAndPathWithServiceNames(
                        projectDomainId,
                        subdomain,
                        basePath,
                        excludeServiceId
                    )
                return decideAvailability(existing, basePath)
            }).pipe(
                Effect.tapError((error) =>
                    Effect.logError(
                        `Subdomain availability check failed: ${error.message}`
                    )
                )
            )
        }
    }
}
