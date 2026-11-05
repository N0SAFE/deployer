import { ORPCError, type ClientContext, type ClientLink } from '@orpc/client'
import { describe, expect, it, vi } from 'vitest'

import {
    grantDirect,
    type MeshRelayEvent,
} from '@deployer/node-agent-contracts'

import { grantFollowingLink } from './grant-link'
import { relayLink } from './relay-link'

type Link = ClientLink<ClientContext>

async function* events(
    ...all: MeshRelayEvent[]
): AsyncGenerator<MeshRelayEvent> {
    for (const event of all) {
        await Promise.resolve()
        yield event
    }
}

const target = { service: 'runtime', key: 'stream-1' }
const call = (link: Link, path = ['logs', 'list']) =>
    link.call(path, { id: 1 }, { context: {} })

describe('relayLink', () => {
    it('sends every procedure to the agent as one relay call carrying the target, path and input', async () => {
        const agent: Link = {
            call: vi
                .fn()
                .mockResolvedValue(events({ kind: 'value', value: 1 })),
        }

        await call(relayLink({ agent, target }))

        expect(agent.call).toHaveBeenCalledWith(
            ['relay', 'call'],
            {
                service: 'runtime',
                key: 'stream-1',
                path: ['logs', 'list'],
                input: { id: 1 },
            },
            { context: {} }
        )
    })

    it('returns a unary answer as the value itself', async () => {
        const agent: Link = {
            call: vi
                .fn()
                .mockResolvedValue(
                    events({ kind: 'value', value: { ok: true } })
                ),
        }

        await expect(call(relayLink({ agent, target }))).resolves.toEqual({
            ok: true,
        })
    })

    it('returns a stream as an async iterator of its elements', async () => {
        const agent: Link = {
            call: vi
                .fn()
                .mockResolvedValue(
                    events(
                        { kind: 'stream' },
                        { kind: 'item', value: 'a' },
                        { kind: 'item', value: 'b' }
                    )
                ),
        }

        const stream = (await call(
            relayLink({ agent, target })
        )) as AsyncIterable<string>
        const received: string[] = []
        for await (const item of stream) {
            received.push(item)
        }

        expect(received).toEqual(['a', 'b'])
    })

    it("passes the target's own error through unchanged", async () => {
        const agent: Link = {
            call: vi
                .fn()
                .mockRejectedValue(
                    new ORPCError('NOT_FOUND', { message: 'no such stream' })
                ),
        }

        await expect(call(relayLink({ agent, target }))).rejects.toMatchObject({
            code: 'NOT_FOUND',
        })
    })

    it('rejects an answer that never arrives', async () => {
        const agent: Link = { call: vi.fn().mockResolvedValue(events()) }

        await expect(call(relayLink({ agent, target }))).rejects.toMatchObject({
            code: 'BAD_GATEWAY',
        })
    })

    it('rejects an item that was not announced by a stream', async () => {
        const agent: Link = {
            call: vi.fn().mockResolvedValue(events({ kind: 'item', value: 1 })),
        }

        await expect(call(relayLink({ agent, target }))).rejects.toMatchObject({
            code: 'BAD_GATEWAY',
        })
    })

    it('lets the grant follower replay a call the agent answered with a grant', async () => {
        const agent: Link = {
            call: vi.fn().mockRejectedValue(
                grantDirect({
                    replicaId: 'runtime-2',
                    address: 'ws://x',
                    token: 't',
                    expiresAt: 9_999_999_999_999,
                })
            ),
        }
        const replica: Link = {
            call: vi.fn().mockResolvedValue('from replica'),
        }
        const link = grantFollowingLink({
            agent: relayLink({ agent, target: { ...target, heavy: true } }),
            direct: () => replica,
        })

        await expect(call(link)).resolves.toBe('from replica')
        expect(replica.call).toHaveBeenCalledWith(
            ['logs', 'list'],
            { id: 1 },
            { context: {} }
        )
    })
})
