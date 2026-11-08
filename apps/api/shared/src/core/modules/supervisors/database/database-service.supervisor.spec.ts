import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import type { DockerEngineShape } from '@deployer/docker'
import { SupervisorOrchestrator } from '@deployer/supervision'

import { harness, testBus } from '../supervisor-test-harness'

import {
    DATABASE_SERVICE_SUPERVISOR_ID,
    makeDatabaseServiceRegistration,
} from './database-service.supervisor'

import type { EnvService } from '../../../../config/env/env.module'

/**
 * The host's job is wiring and the registration decision: the `MANAGED_DATABASE_*` environment reaches
 * the Effect supervisor, and the supervisor registers only when it owns the instances. The supervisor's
 * own behaviour is tested in `@deployer/platform-supervisors`.
 */
function makeSupervisor(values: Record<string, unknown>) {
    const reconciled: string[] = []
    const engine = {
        swarmCluster: { isActive: () => Effect.succeed(true) },
        networks: { ensureOverlay: () => Effect.void },
        volumes: { ensure: () => Effect.void },
        swarmServices: {
            reconcile: (spec: { name: string }) =>
                Effect.sync(() => {
                    reconciled.push(spec.name)
                }),
            inspect: (name: string) =>
                Effect.succeed({
                    ID: `svc-${name}`,
                    CreatedAt: '',
                    UpdatedAt: '',
                    Spec: { Name: name },
                }),
            listTasks: () => Effect.succeed([{ Status: { State: 'running' } }]),
        },
    }
    const env = {
        get: vi.fn((key: string) => values[key]),
    } as unknown as EnvService
    const supervisor = harness(
        makeDatabaseServiceRegistration({
            engine: engine as unknown as DockerEngineShape,
            env,
            bus: testBus(),
        })
    )
    const orchestrator = new SupervisorOrchestrator.live()
    return { supervisor, orchestrator, reconciled }
}

describe('database-service supervisor registration', () => {
    it('registers and converges the instances named in MANAGED_DATABASE_INSTANCES, trimmed and deduplicated', async () => {
        const { supervisor, orchestrator, reconciled } = makeSupervisor({
            MANAGED_DATABASE_INSTANCES: ' db-a, db-b ,db-a,',
        })
        await supervisor.register(orchestrator)
        expect(orchestrator.has(DATABASE_SERVICE_SUPERVISOR_ID)).toBe(true)

        expect(await supervisor.ensureDesiredState()).toBe('converged')
        expect(reconciled.sort()).toEqual([
            'deployer-database-db-a',
            'deployer-database-db-b',
        ])
    })

    it('does not register when the deployment owns the instances', async () => {
        const { supervisor, orchestrator } = makeSupervisor({
            MANAGED_DATABASE_ENABLED: 'true',
            MANAGED_DATABASE_INSTANCES: 'db-a',
        })
        await supervisor.register(orchestrator)
        expect(orchestrator.has(DATABASE_SERVICE_SUPERVISOR_ID)).toBe(false)
    })

    it('does not register when no instance is configured', async () => {
        const { supervisor, orchestrator } = makeSupervisor({})
        await supervisor.register(orchestrator)
        expect(orchestrator.has(DATABASE_SERVICE_SUPERVISOR_ID)).toBe(false)
    })
})
