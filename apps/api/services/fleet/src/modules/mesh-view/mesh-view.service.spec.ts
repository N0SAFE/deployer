import { describe, expect, it, vi } from 'vitest'

import { MeshViewService } from './mesh-view.service'

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

function agentAnswering(answers: Record<string, unknown>) {
    const call = vi.fn(async (path: string[]) => {
        const answer = answers[path.join('.')]
        if (answer instanceof Error) throw answer
        return answer
    })
    return { call } as never
}

const view = {
    self: { nodeId: 'node-a', address: 'a:1' },
    agents: [{ nodeId: 'node-b', address: 'b:1' }],
}

describe('MeshViewService', () => {
    it('lists this node first, then the agents it knows of', async () => {
        const service = new MeshViewService(
            () => agentAnswering({ 'roster.view': view }),
            async () => ({ nodeId: 'alone' })
        )
        expect((await service.peers()).items).toEqual([
            { nodeId: 'node-a', address: 'a:1', local: true },
            { nodeId: 'node-b', address: 'b:1', local: false },
        ])
    })

    it('is a swarm of one without an agent', async () => {
        const service = new MeshViewService(
            () => undefined,
            async () => ({ nodeId: 'alone' })
        )
        expect(await service.localNode()).toEqual({
            nodeId: 'alone',
            address: '',
            local: true,
        })
        expect((await service.snapshot()).replicas).toEqual([])
        expect(await service.lookup({ service: 'runtime' })).toEqual({
            found: false,
            replica: null,
            reason: null,
        })
        await expect(service.issueToken({ ttlMs: 1000 })).rejects.toThrow(
            'no mesh agent'
        )
    })

    it('answers a snapshot with the replicas of the directory, without the lease fields', async () => {
        const service = new MeshViewService(
            () =>
                agentAnswering({
                    'roster.view': view,
                    'directory.snapshot': { replicas: [replica] },
                }),
            async () => ({ nodeId: 'x' })
        )
        const snapshot = await service.snapshot()
        expect(snapshot.replicas).toEqual([
            {
                service: 'runtime',
                replicaId: 'r1',
                nodeId: 'node-a',
                load: 0.2,
                keys: ['c1'],
            },
        ])
        expect(snapshot.nodes).toHaveLength(2)
    })

    it('says not found when the directory has no live replica', async () => {
        const service = new MeshViewService(
            () =>
                agentAnswering({
                    'directory.resolve': Object.assign(new Error('none'), {
                        code: 'NOT_FOUND',
                    }),
                }),
            async () => ({ nodeId: 'x' })
        )
        expect(await service.lookup({ service: 'runtime', key: 'c9' })).toEqual(
            { found: false, replica: null, reason: null }
        )
    })

    it('sends a topology snapshot, and another only when something changed', async () => {
        vi.useFakeTimers()
        const answers: Record<string, unknown> = {
            'roster.view': view,
            'directory.snapshot': { replicas: [] },
        }
        const service = new MeshViewService(
            () => agentAnswering(answers),
            async () => ({ nodeId: 'x' }),
            1000
        )
        const seen: number[] = []
        const subscription = service
            .topology()
            .subscribe((snapshot) => seen.push(snapshot.nodes.length))
        await vi.advanceTimersByTimeAsync(2500)
        expect(seen).toEqual([2])
        answers['roster.view'] = { ...view, agents: [] }
        await vi.advanceTimersByTimeAsync(1000)
        expect(seen).toEqual([2, 1])
        subscription.unsubscribe()
        vi.useRealTimers()
    })
})
