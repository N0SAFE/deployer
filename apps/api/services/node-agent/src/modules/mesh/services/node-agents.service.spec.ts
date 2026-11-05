import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import type { AgentInfo } from '@deployer/node-agent-contracts'

import {
    AgentLinkFactory,
    type AgentLinkFactoryShape,
} from './agent-link-factory.service'
import { NodeAgents } from './node-agents.service'

import type { ClientContext, ClientLink } from '@orpc/client'

const agent = (nodeId: string, address = `ws://${nodeId}`): AgentInfo => ({
    nodeId,
    address,
    overlay: null,
    labels: {},
})

const fakeLink = () => ({
    call: vi.fn(),
    closeAll: vi.fn(async () => undefined),
})

/** A registry over an empty (or pre-seeded) roster, with a link factory that records how often it is asked for a link. */
function registry(nodeIds: readonly string[] = []) {
    const factory: AgentLinkFactoryShape = {
        linkTo: vi.fn(() => fakeLink() as ClientLink<ClientContext>),
    }
    const agents = new NodeAgents.live(
        new Map(nodeIds.map((nodeId) => [nodeId, agent(nodeId)]))
    )
    const run = <A, E>(effect: Effect.Effect<A, E, AgentLinkFactory>) =>
        Effect.runPromise(
            effect.pipe(Effect.provideService(AgentLinkFactory, factory))
        )
    return { agents, factory, run }
}

describe('NodeAgents', () => {
    it('learns a node without opening a link to it', async () => {
        const { agents, factory } = registry()

        expect(await Effect.runPromise(agents.know(agent('B')))).toBe(true)
        expect(await Effect.runPromise(agents.know(agent('B')))).toBe(false)

        expect(await Effect.runPromise(agents.known())).toEqual([agent('B')])
        expect(factory.linkTo).not.toHaveBeenCalled()
    })

    it('opens the link on first use, then answers from the cache', async () => {
        const { agents, factory, run } = registry(['B'])

        const first = await run(agents.linkTo('B'))
        const second = await run(agents.linkTo('B'))

        expect(second).toBe(first)
        expect(factory.linkTo).toHaveBeenCalledTimes(1)
        expect(factory.linkTo).toHaveBeenCalledWith('ws://B')
        expect(first.call).toBeTypeOf('function')
    })

    it('fails with MeshNoNode for a node it does not know', async () => {
        const { agents, factory, run } = registry(['B'])

        const settled = await run(
            agents.linkTo('Z').pipe(
                Effect.match({
                    onSuccess: (value) => ({ value }),
                    onFailure: (error) => ({ error }),
                })
            )
        )

        expect(settled).toMatchObject({
            error: { _tag: 'MeshNoNode', nodeId: 'Z' },
        })
        expect(factory.linkTo).not.toHaveBeenCalled()
    })

    it('forgets the node and closes the link cached for it', async () => {
        const { agents, factory, run } = registry(['B'])
        const link = (await run(agents.linkTo('B'))) as unknown as {
            closeAll: () => Promise<void>
        }

        await Effect.runPromise(agents.forget('B'))
        const settled = await run(
            agents.linkTo('B').pipe(
                Effect.match({
                    onSuccess: (value) => ({ value }),
                    onFailure: (error) => ({ error }),
                })
            )
        )

        expect(settled).toMatchObject({
            error: { _tag: 'MeshNoNode', nodeId: 'B' },
        })
        expect(link.closeAll).toHaveBeenCalledTimes(1)
        expect(factory.linkTo).toHaveBeenCalledTimes(1)
        expect(await Effect.runPromise(agents.known())).toEqual([])
    })

    it('drops the cached link when the node is re-learned at another address', async () => {
        const { agents, factory, run } = registry(['B'])
        await run(agents.linkTo('B'))

        await Effect.runPromise(agents.know(agent('B', 'ws://B-moved')))
        await run(agents.linkTo('B'))

        expect(factory.linkTo).toHaveBeenCalledTimes(2)
        expect(factory.linkTo).toHaveBeenLastCalledWith('ws://B-moved')
    })

    it('keeps who taught it each node, and drops that with the node', async () => {
        const { agents } = registry()

        await Effect.runPromise(agents.know(agent('C'), 'B'))
        await Effect.runPromise(agents.know(agent('C'), 'D'))

        expect(await Effect.runPromise(agents.sourcesOf('C'))).toEqual([
            'B',
            'D',
        ])
        expect(await Effect.runPromise(agents.sourcesOf('B'))).toEqual([])

        await Effect.runPromise(agents.forget('C'))
        expect(await Effect.runPromise(agents.sourcesOf('C'))).toEqual([])
    })

    it('remembers a node as unreachable for the window it was marked, then not at all', async () => {
        vi.useFakeTimers()
        try {
            const { agents } = registry(['B'])
            vi.setSystemTime(1_000)

            await Effect.runPromise(agents.markUnreachable('B', 30_000))
            expect(await Effect.runPromise(agents.isUnreachable('B'))).toBe(
                true
            )

            vi.setSystemTime(31_000)
            expect(await Effect.runPromise(agents.isUnreachable('B'))).toBe(
                false
            )
        } finally {
            vi.useRealTimers()
        }
    })

    it('clears an unreachable mark on demand, when the node is re-learned at a new address, and on forget', async () => {
        const { agents } = registry(['B', 'C', 'D'])

        await Effect.runPromise(agents.markUnreachable('B', 30_000))
        await Effect.runPromise(agents.clearUnreachable('B'))
        expect(await Effect.runPromise(agents.isUnreachable('B'))).toBe(false)

        await Effect.runPromise(agents.markUnreachable('C', 30_000))
        await Effect.runPromise(agents.know(agent('C', 'ws://C-moved')))
        expect(await Effect.runPromise(agents.isUnreachable('C'))).toBe(false)

        await Effect.runPromise(agents.markUnreachable('D', 30_000))
        await Effect.runPromise(agents.forget('D'))
        expect(await Effect.runPromise(agents.isUnreachable('D'))).toBe(false)
    })
})
