import { describe, expect, it } from 'vitest'

import { groupContainersIntoStacks, stackNameOf } from './stack-grouping'

const container = (id: string, over: Record<string, unknown> = {}) =>
    ({
        id,
        projectId: 'p1',
        serviceId: `svc-${id}`,
        imageId: null,
        status: 'running',
        networkIds: ['n1'],
        volumeIds: [],
        createdAt: '2026-10-01T00:00:00.000Z',
        ...over,
    }) as never

const NOW = '2026-10-02T00:00:00.000Z'

describe('stack grouping', () => {
    it('names a stack from the compose project, then the swarm namespace, else standalone', () => {
        expect(
            stackNameOf({
                'com.docker.compose.project': 'shop',
                'com.docker.stack.namespace': 'x',
            })
        ).toBe('shop')
        expect(stackNameOf({ 'com.docker.stack.namespace': 'swarm' })).toBe(
            'swarm'
        )
        expect(stackNameOf({})).toBe('standalone')
    })

    it('groups containers by stack, merging networks without repeats', () => {
        const stacks = groupContainersIntoStacks(
            [
                { stackName: 'shop', container: container('a') },
                {
                    stackName: 'shop',
                    container: container('b', { networkIds: ['n1', 'n2'] }),
                },
                { stackName: 'standalone', container: container('c') },
            ],
            NOW
        )
        expect(stacks.map((stack) => stack.name)).toEqual([
            'shop',
            'standalone',
        ])
        expect(stacks[0]?.services).toHaveLength(2)
        expect(stacks[0]?.networkIds).toEqual(['n1', 'n2'])
        expect(stacks[0]?.updatedAt).toBe(NOW)
    })

    it('derives status from the first container and fails the stack when one dies', () => {
        const first = groupContainersIntoStacks(
            [
                {
                    stackName: 's',
                    container: container('a', { status: 'paused' }),
                },
            ],
            NOW
        )
        expect(first[0]?.status).toBe('degraded')

        const failed = groupContainersIntoStacks(
            [
                { stackName: 's', container: container('a') },
                {
                    stackName: 's',
                    container: container('b', { status: 'dead' }),
                },
                { stackName: 's', container: container('c') },
            ],
            NOW
        )
        expect(failed[0]?.status).toBe('failed')
    })
})
