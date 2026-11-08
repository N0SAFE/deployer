import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { SWARM_APP_WIRING_SUPERVISOR_ID } from '../supervisors/platform/swarm-app-wiring.supervisor'

import { BootstrapOrchestratorService } from './bootstrap-orchestrator.service'

/**
 * The API tier boots BEHIND setup. Until the operator's decision has been executed (`setup_done`), the boot pipeline
 * must start NOTHING: no overlay wiring, no database supervisor, no migration, no default admin. Each of those is a
 * side effect on the world that the wizard's own flow owns on a fresh install.
 */
function makeOrchestrator(
    config: { databaseUrl?: string | null; setupState?: string } | null
) {
    const convergeNow = vi.fn((_id: string) => Effect.succeed(null))
    const ensureDatabaseAvailable = vi.fn(() => Effect.void)
    const acquire = vi.fn(() => Effect.succeed(false))
    const lifecycle = {
        transitionNow: vi.fn(),
        markReadyNow: vi.fn(),
        markErrorNow: vi.fn(),
    }

    const service = new BootstrapOrchestratorService.live({
        pool: {} as never,
        db: {} as never,
        nodeConfigRepository: { find: () => Effect.succeed(config) } as never,
        lifecycle: lifecycle as never,
        startupGuard: { ensureDatabaseAvailable },
        bootstrapLock: { acquire, release: vi.fn(() => Effect.void) },
        orchestrator: { convergeNow } as never,
    })
    /** The boot pipeline is the service's `onApplicationBootstrap` lifecycle step: it runs once every module has initialised. */
    const boot = () => Effect.runPromise(service.onApplicationBootstrap())
    return { boot, convergeNow, ensureDatabaseAvailable, acquire, lifecycle }
}

describe('BootstrapOrchestratorService: nothing starts before the setup decision is executed', () => {
    it.each([
        ['no node_config row at all (nobody has chosen anything)', null],
        [
            'a row with no database yet',
            { databaseUrl: null, setupState: 'not_started' },
        ],
        [
            'a database URL persisted but setup still provisioning',
            {
                databaseUrl: 'postgresql://u:p@db:5432/d',
                setupState: 'in_progress',
            },
        ],
        [
            'a database URL persisted, setup not started',
            {
                databaseUrl: 'postgresql://u:p@db:5432/d',
                setupState: 'not_started',
            },
        ],
    ])(
        '%s: converges no supervisor, probes no database, takes no lock, and never reports READY',
        async (_name, config) => {
            const node = makeOrchestrator(config)

            await node.boot()

            expect(node.convergeNow).not.toHaveBeenCalled()
            expect(node.ensureDatabaseAvailable).not.toHaveBeenCalled()
            expect(node.acquire).not.toHaveBeenCalled()
            expect(node.lifecycle.markReadyNow).not.toHaveBeenCalled()
            expect(node.lifecycle.markErrorNow).not.toHaveBeenCalled()
        }
    )

    it('once setup_done, the pipeline DOES start: overlay, then the database supervisor, then the reachability probe', async () => {
        const node = makeOrchestrator({
            databaseUrl: 'postgresql://u:p@db:5432/d',
            setupState: 'setup_done',
        })

        // The lock is not acquired (a peer replica "holds" it), which ends the run right after the probe — enough to
        // prove the pipeline left the gate without needing a real database to migrate.
        await node.boot()

        expect(node.convergeNow.mock.calls.map(([id]) => id)).toEqual([
            SWARM_APP_WIRING_SUPERVISOR_ID,
            'global-db-postgres',
        ])
        expect(node.ensureDatabaseAvailable).toHaveBeenCalledTimes(1)
        expect(node.acquire).toHaveBeenCalledTimes(1)
    })
})
