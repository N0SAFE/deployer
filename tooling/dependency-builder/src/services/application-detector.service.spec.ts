import { describe, expect, it } from 'vitest'

import { ApplicationDetector } from './application-detector.service'
import { NoEnabledApplicationsError } from '../errors'
import type { Workspace } from '../schemas'

/**
 * The detection rule, encoded as a test.
 *
 * The rule has three parts that a future edit is most likely to break, and each
 * is asserted separately below:
 *
 *  - `all` resolves to EVERY application, not a lookup of a workspace named
 *    "all" — it is the default profile, not an application name
 *  - a profile that names no application is IGNORED, because a profile may exist
 *    purely to group infrastructure
 *  - a profile that names an application the repository does not contain is
 *    FATAL, because it means the compose file and the workspace tree diverged
 *
 * The `COMPOSE_PROFILES` value is injected rather than read from `process.env`,
 * so these cases do not depend on how the test runner was started.
 */

/** A workspace map with just the fields the detector reads. */
function workspaces(...names: string[]): Map<string, Workspace> {
    return new Map(
        names.map((name) => [name, { name, dir: `packages/${name}`, internalDeps: [] }])
    )
}

/** The applications this repository has (the API tier counts as six), plus one non-application package. */
const REPO = workspaces(
    '@deployer/bff',
    '@deployer/svc-health',
    '@deployer/svc-identity',
    '@deployer/svc-project',
    '@deployer/svc-runtime',
    '@deployer/svc-fleet',
    '@deployer/web',
    '@deployer/setup',
    '@deployer/doc',
    '@deployer/type-guards'
)

/** What the `api` and `services` profiles enable, sorted as the detector returns it. */
const TIER = [
    '@deployer/bff',
    '@deployer/svc-fleet',
    '@deployer/svc-health',
    '@deployer/svc-identity',
    '@deployer/svc-project',
    '@deployer/svc-runtime',
]

const detector = new ApplicationDetector()

function detect(value: string): string[] {
    return detector.detect(REPO, { COMPOSE_PROFILES: value })
}

describe('ApplicationDetector', () => {
    it('resolves `all` to every application, sorted', () => {
        expect(detect('all')).toEqual(
            [...TIER, '@deployer/doc', '@deployer/setup', '@deployer/web'].sort()
        )
    })

    it('resolves `api` to the whole API tier, not to a monolith package', () => {
        expect(detect('api')).toEqual(TIER)
        expect(detect('api')).not.toContain('@deployer/api')
    })

    it('resolves `api` and `services` to the same applications', () => {
        expect(detect('services')).toEqual(detect('api'))
    })

    it('resolves a single-application profile to that one application', () => {
        expect(detect('doc')).toEqual(['@deployer/doc'])
    })

    it('unions several profiles, without duplicates', () => {
        expect(detect('api,web')).toEqual([...TIER, '@deployer/web'].sort())
        expect(detect('api,api,doc')).toEqual(['@deployer/doc', ...TIER].sort())
    })

    it('tolerates whitespace around profile names', () => {
        expect(detect(' api , web ')).toEqual([...TIER, '@deployer/web'].sort())
    })

    it('unions a multi-application profile with a single-application one', () => {
        const resolved = detect('services,web')
        expect(resolved).toContain('@deployer/web')
        expect(resolved).toContain('@deployer/bff')
        expect(resolved).toContain('@deployer/svc-runtime')
        expect(resolved).toHaveLength(7)
    })

    it('reports a profile whose workspace is missing, rather than silently skipping it', () => {
        // Skipping a missing `@deployer/svc-*` would build an incomplete union for
        // containers that import it.
        const withoutTier = workspaces('@deployer/web', '@deployer/doc')
        expect(() =>
            detector.detect(withoutTier, { COMPOSE_PROFILES: 'services' })
        ).toThrow(NoEnabledApplicationsError)
    })

    it('lets `all` short-circuit the other profiles in the same value', () => {
        // `all` means every application, so naming one alongside it adds nothing.
        expect(detect('all,api')).toEqual(detect('all'))
    })

    it('ignores a profile that names no application', () => {
        // A profile may exist purely to group infrastructure. It contributes no
        // application, and the union still resolves from the rest.
        expect(detect('observability,api')).toEqual(TIER)
    })

    it('rejects a value that names no application at all', () => {
        expect(() => detect('observability')).toThrow(NoEnabledApplicationsError)
    })

    it('rejects an empty or whitespace-only value', () => {
        expect(() => detect('')).toThrow(NoEnabledApplicationsError)
        expect(() => detect('  ,  ')).toThrow(NoEnabledApplicationsError)
    })

    it('rejects an unset value rather than silently enabling everything', () => {
        // The container must be started through a compose profile. Defaulting to
        // "all" here would build packages for applications that are not running,
        // and hide the misconfiguration instead of naming it.
        expect(() => detector.detect(REPO, {})).toThrow(
            NoEnabledApplicationsError
        )
    })

    it('rejects a profile whose workspace the repository does not contain', () => {
        // The converse of the "ignores" case above: the profile IS an
        // application name, but the tree has no such workspace — so the compose
        // file and the workspace have diverged, which is fatal rather than
        // ignored.
        const withoutTier = workspaces('@deployer/web')
        expect(() =>
            detector.detect(withoutTier, { COMPOSE_PROFILES: 'api' })
        ).toThrow(NoEnabledApplicationsError)
    })
})
