import { Cause, Effect, Exit } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import {
    buildPostgresSpec,
    makePostgresProvisioner,
    PostgresProvisionFailed,
} from './postgres'

const identity = {
    databaseName: 'deployer',
    username: 'deployer',
    password: 'deployer',
    image: 'postgres:16-alpine',
}

async function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
    const exit = await Effect.runPromiseExit(effect)
    if (Exit.isSuccess(exit)) return exit.value
    throw Cause.squash(exit.cause)
}

describe('buildPostgresSpec', () => {
    /**
     * REGRESSION GUARD: the data directory is exclusive, so a replacement task can never run alongside
     * the old one. `start-first` would start the new task before the old one released the data
     * directory and leave the service at 0/1 forever (database unreachable, API cannot boot).
     */
    it('uses stop-first, because its data directory is exclusive', () => {
        expect(buildPostgresSpec({ identity }).updateConfig.order).toBe(
            'stop-first'
        )
    })

    /**
     * SECURITY GUARD: no host-published port. A publish bound 0.0.0.0:5432 on the node put the
     * platform's state store on every interface; consumers reach it on the platform overlay instead.
     */
    it('publishes no port and leaves the overlay to the caller', () => {
        const spec = buildPostgresSpec({ identity })

        expect(spec.endpointPorts).toEqual([])
        expect(spec.networks).toEqual([])
    })
})

describe('PostgresProvisioner.ensure', () => {
    function provisioner(tasks: { Status: { State: string; Err?: string } }[]) {
        const reconcile = vi.fn(() => Effect.void)
        const ensureOverlay = vi.fn(() => Effect.void)
        const remove = vi.fn(() => Effect.void)
        return {
            reconcile,
            ensureOverlay,
            remove,
            provisioner: makePostgresProvisioner({
                swarmServices: {
                    reconcile,
                    listTasks: () => Effect.succeed(tasks as never),
                    remove,
                },
                networks: { ensureOverlay },
            }),
        }
    }

    it('creates the overlay, reconciles the service on it, and returns once a task runs', async () => {
        const {
            provisioner: p,
            reconcile,
            ensureOverlay,
        } = provisioner([{ Status: { State: 'running' } }])

        const spec = await run(p.ensure({ identity }))

        expect(ensureOverlay).toHaveBeenCalledWith(
            expect.objectContaining({ driver: 'overlay' })
        )
        expect(reconcile).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'deployer-postgres' }),
            1
        )
        expect(spec.networks[0]?.aliases).toContain('global-db')
    })

    it('fails when the scheduler rejects the service', async () => {
        const { provisioner: p } = provisioner([
            { Status: { State: 'rejected', Err: 'no suitable node' } },
        ])

        await expect(run(p.ensure({ identity }))).rejects.toThrow(
            /rejected by the scheduler: no suitable node/
        )
    })

    it('fails when no task ever runs', async () => {
        const { provisioner: p } = provisioner([])

        await expect(
            run(p.ensure({ identity, waitAttempts: 2, waitIntervalMs: 1 }))
        ).rejects.toBeInstanceOf(PostgresProvisionFailed)
    })

    it('removes the service scoped by the prefix', async () => {
        const { provisioner: p, remove } = provisioner([])

        await run(p.remove('eu'))

        expect(remove).toHaveBeenCalledWith('deployer-postgres-eu')
    })
})
