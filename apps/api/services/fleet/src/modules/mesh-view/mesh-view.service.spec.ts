import { Cause, Effect, Exit } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { provideTo } from '@deployer/effect-core'

import { FleetInvalid } from '../../core/fleet.errors'

import { MeshAgent } from './mesh-view.ports'
import { MeshAgentCallFailed, MeshView } from './mesh-view.service'

import type { ClientContext, ClientLink } from '@orpc/client'

const replica = {
    service: 'runtime',
    replicaId: 'r1',
    nodeId: 'node-a',
    address: 'x',
    load: 0.2,
    keys: ['c1'],
    generation: 1,
    expiresAt: 9,
}

const view = {
    self: { nodeId: 'node-a', address: 'a:1' },
    agents: [{ nodeId: 'node-b', address: 'b:1' }],
}

/** An agent that answers by procedure path; an `Error` is thrown, so a test can name the code the agent would carry. */
function agentAnswering(answers: Record<string, unknown>) {
    return {
        call: vi.fn((path: string[]) => {
            const answer = answers[path.join('.')]
            return answer instanceof Error
                ? Promise.reject(answer)
                : Promise.resolve(answer)
        }),
    } as unknown as ClientLink<ClientContext>
}

/** The service with its agent replaced: `undefined` is a node with no agent. */
function meshViewOver(link: () => ClientLink<ClientContext> | undefined) {
    return provideTo(
        new MeshView.live(),
        (effect) =>
            effect.pipe(
                Effect.provideService(MeshAgent, {
                    link,
                    standalone: () => Effect.succeed({ nodeId: 'alone' }),
                })
            ) as Effect.Effect<unknown>
    )
}

const failureOf = async (effect: Effect.Effect<unknown, unknown>) => {
    const exit = await Effect.runPromiseExit(effect)
    if (Exit.isSuccess(exit)) throw new Error('expected a failure')
    return Cause.squash(exit.cause)
}

describe('MeshView', () => {
    it('lists this node first, then the agents it knows of', async () => {
        const service = meshViewOver(() => agentAnswering({ 'roster.view': view }))

        expect((await Effect.runPromise(service.peers())).items).toEqual([
            { nodeId: 'node-a', address: 'a:1', local: true },
            { nodeId: 'node-b', address: 'b:1', local: false },
        ])
    })

    it('is a swarm of one without an agent', async () => {
        const service = meshViewOver(() => undefined)

        expect(await Effect.runPromise(service.localNode())).toEqual({
            nodeId: 'alone',
            address: '',
            local: true,
        })
        expect((await Effect.runPromise(service.snapshot())).replicas).toEqual([])
        expect(await Effect.runPromise(service.lookup({ service: 'runtime' }))).toEqual({
            found: false,
            replica: null,
            reason: null,
        })
        expect(await failureOf(service.issueToken({ ttlMs: 1000 }))).toBeInstanceOf(
            FleetInvalid
        )
    })

    it('answers a snapshot with the replicas of the directory, without the lease fields', async () => {
        const service = meshViewOver(() =>
            agentAnswering({
                'roster.view': view,
                'directory.snapshot': { replicas: [replica] },
            })
        )

        const snapshot = await Effect.runPromise(service.snapshot())

        expect(snapshot.replicas).toEqual([
            { service: 'runtime', replicaId: 'r1', nodeId: 'node-a', load: 0.2, keys: ['c1'] },
        ])
        expect(snapshot.nodes).toHaveLength(2)
    })

    it('says not found when the directory has no live replica', async () => {
        const service = meshViewOver(() =>
            agentAnswering({
                'directory.resolve': Object.assign(new Error('none'), { code: 'NOT_FOUND' }),
            })
        )

        expect(
            await Effect.runPromise(service.lookup({ service: 'runtime', key: 'c9' }))
        ).toEqual({ found: false, replica: null, reason: null })
    })

    it('names the replica a lookup would reach, and why', async () => {
        const service = meshViewOver(() =>
            agentAnswering({
                'directory.resolve': { replica, reason: 'key-holder' },
            })
        )

        expect(
            await Effect.runPromise(service.lookup({ service: 'runtime', key: 'c1' }))
        ).toMatchObject({ found: true, reason: 'key-holder', replica: { replicaId: 'r1' } })
    })

    it('fails with a typed error, not a raw one, when the agent errors with anything but not-found', async () => {
        const service = meshViewOver(() =>
            agentAnswering({
                'directory.resolve': Object.assign(new Error('boom'), { code: 'INTERNAL' }),
            })
        )

        expect(
            await failureOf(service.lookup({ service: 'runtime' }))
        ).toBeInstanceOf(MeshAgentCallFailed)
    })

    it('does not trust an answer that is not the shape it asked for', async () => {
        const service = meshViewOver(() =>
            agentAnswering({ 'roster.view': { self: 'nobody' } })
        )

        expect(await failureOf(service.peers())).toBeInstanceOf(MeshAgentCallFailed)
    })

    it('issues the token the agent returns', async () => {
        const service = meshViewOver(() =>
            agentAnswering({ 'roster.token': { token: 't', expiresAt: 5 } })
        )

        expect(await Effect.runPromise(service.issueToken({ ttlMs: 1000 }))).toEqual({
            token: 't',
            expiresAt: 5,
        })
    })

    it('sends a topology snapshot, and another only when something changed', async () => {
        vi.useFakeTimers()
        const answers: Record<string, unknown> = {
            'roster.view': view,
            'directory.snapshot': { replicas: [] },
        }
        const service = meshViewOver(() => agentAnswering(answers))
        const topology = await Effect.runPromise(service.topology(1000))
        const seen: number[] = []

        const subscription = topology.subscribe((snapshot) => seen.push(snapshot.nodes.length))
        await vi.advanceTimersByTimeAsync(2500)
        expect(seen).toEqual([2])
        answers['roster.view'] = { ...view, agents: [] }
        await vi.advanceTimersByTimeAsync(1000)
        expect(seen).toEqual([2, 1])

        subscription.unsubscribe()
        vi.useRealTimers()
    })
})
