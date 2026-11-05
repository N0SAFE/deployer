import { Cause, Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'

import { makeSwarmParticipation } from './swarm-participation'

async function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
    const exit = await Effect.runPromiseExit(effect)
    if (Exit.isSuccess(exit)) return exit.value
    throw Cause.squash(exit.cause)
}

function makeService() {
    return makeSwarmParticipation({
        defaults: {},
        nodeConfig: {
            find: () =>
                Effect.succeed({
                    swarmConfig: {
                        mode: 'create',
                        policy: 'auto',
                        advertiseAddr: null,
                        joinToken: 'SWMTKN-stored',
                        joinAddrs: [],
                    },
                    setupState: 'setup_done',
                    configuredAt: '2026-01-01T00:00:00.000Z',
                }),
        } as never,
        clusterNode: {} as never,
        cluster: {
            getLocalClusterSnapshot: () =>
                Effect.succeed({
                    localNode: { swarmRole: 'manager', availability: 'active' },
                    nodeCount: 1,
                    managerCount: 1,
                }),
            getJoinTokens: () =>
                Effect.succeed({
                    worker: 'SWMTKN-worker',
                    manager: 'SWMTKN-manager',
                }),
        } as never,
        docker: {
            swarmCluster: {
                info: () => Effect.succeed({ LocalNodeState: 'active' }),
            },
        } as never,
    })
}

describe('SwarmParticipation.view', () => {
    it('reports the live cluster state without echoing join tokens', async () => {
        const view = await run(makeService().view())

        expect(view).toMatchObject({
            engineState: 'active',
            role: 'manager',
            nodeCount: 1,
            managerCount: 1,
        })
        expect('joinTokens' in view).toBe(false)
        expect(view.participation.joinToken).toBeNull()
        expect(JSON.stringify(view)).not.toContain('SWMTKN')
    })
})
