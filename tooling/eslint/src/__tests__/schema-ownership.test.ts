import { describe, expect, it } from 'vitest'

import { loadSchemaOwnership } from '../schema-ownership'

/**
 * The schema boundary is enforced by a lint rule that reads the ownership registry at
 * lint time. These tests assert the facts that rule depends on, so a registry edit that
 * would silently widen or narrow a boundary shows up here rather than in a service.
 */
describe('schema ownership registry', () => {
    const ownership = loadSchemaOwnership()

    it('claims every table exactly once', () => {
        expect(Object.keys(ownership.tableOwnership).length).toBeGreaterThan(80)
        for (const [table, owner] of Object.entries(ownership.tableOwnership)) {
            expect(owner, `table ${table}`).toMatch(/^(identity|project|runtime|fleet|health|platform|monolith)$/)
        }
    })

    it('resolves the tables the ownership spec split across files', () => {
        // `deployment.ts` was split by owner; these must still resolve to that owner.
        expect(ownership.tableOwnership['projects']).toBe('project')
        expect(ownership.tableOwnership['services']).toBe('project')
        expect(ownership.tableOwnership['environments']).toBe('project')
        expect(ownership.tableOwnership['deployments']).toBe('runtime')
        expect(ownership.tableOwnership['deployment_logs']).toBe('runtime')
    })

    it('treats the shared tables as readable by every declared reader', () => {
        // These are the reads Phase 2 granted; losing one would break analytics,
        // deployment targeting, or the docker view.
        expect(ownership.readers['services']).toEqual(expect.arrayContaining(['project', 'runtime', 'fleet', 'identity']))
        expect(ownership.readers['deployments']).toEqual(expect.arrayContaining(['runtime', 'project', 'fleet', 'identity']))
        expect(ownership.readers['projects']).toEqual(expect.arrayContaining(['project', 'runtime', 'identity']))
        expect(ownership.readers['environments']).toEqual(expect.arrayContaining(['project', 'runtime']))
    })

    it('does not make a shared table writable by its readers', () => {
        // The writer stays single for the tables whose meaning one service owns.
        for (const table of ['services', 'projects', 'environments']) {
            expect(ownership.readers[table]?.[0], `${table} writer`).toBe('project')
        }
        expect(ownership.readers['deployments']?.[0]).toBe('runtime')
        expect(ownership.readers['preview_environments']?.[0]).toBe('fleet')
    })

    it('marks the outbox and platform config as multi-owner', () => {
        // A transactional outbox is written by whoever publishes an event, and platform
        // config is app-wide, so neither fits a single writer.
        expect(ownership.multiOwner.has('local_event_outbox')).toBe(true)
        expect(ownership.multiOwner.has('app_config')).toBe(true)
    })

    it('maps each schema symbol to the owner directory that declares it', () => {
        // The rule resolves an import to an owner through this map, so the split files
        // must report the owner of the TABLE, not of the file it used to share.
        expect(ownership.symbolOwner['projects']).toBe('project')
        expect(ownership.symbolOwner['services']).toBe('project')
        expect(ownership.symbolOwner['deployments']).toBe('runtime')
        expect(ownership.symbolOwner['clusterNodes']).toBe('fleet')
        expect(ownership.symbolOwner['user']).toBe('identity')
    })
})
