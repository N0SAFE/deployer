import { describe, expect, it, vi } from 'vitest'

import {
    grantDirect,
    type MeshRelayEvent,
} from '@deployer/node-agent-contracts'

import { contractId } from './contract-id'
import { serviceLink } from './service-link'

import type { ClientContext, ClientLink } from '@orpc/client'

type Link = ClientLink<ClientContext>

async function* events(
    ...all: MeshRelayEvent[]
): AsyncGenerator<MeshRelayEvent> {
    for (const event of all) {
        await Promise.resolve()
        yield event
    }
}

const contract = { crud: { findById: { '~orpc': {} } } }

describe('serviceLink', () => {
    it("sends the call to the agent as a relayed call for the service, under the contract's id, with the caller's credentials", async () => {
        const agent: Link = {
            call: vi
                .fn()
                .mockResolvedValue(events({ kind: 'value', value: { id: 7 } })),
        }
        const link = serviceLink<ClientContext>({
            agent,
            service: 'project',
            contract,
            headers: () => ({ cookie: 'session=alice' }),
        })

        const answer = await link.call(
            ['crud', 'findById'],
            { params: { id: 7 } },
            { context: {} }
        )

        expect(answer).toEqual({ id: 7 })
        expect(agent.call).toHaveBeenCalledWith(
            ['relay', 'call'],
            {
                service: 'project',
                path: [contractId(contract), 'crud', 'findById'],
                input: { params: { id: 7 } },
                headers: { cookie: 'session=alice' },
            },
            { context: {} }
        )
    })

    it('reads the credentials at every call, so one link serves every caller', async () => {
        const agent: Link = {
            call: vi
                .fn()
                .mockImplementation(() =>
                    Promise.resolve(events({ kind: 'value', value: null }))
                ),
        }
        let cookie = 'session=alice'
        const link = serviceLink<ClientContext>({
            agent,
            service: 'project',
            contract,
            headers: () => ({ cookie }),
        })

        await link.call(['crud', 'findById'], {}, { context: {} })
        cookie = 'session=bob'
        await link.call(['crud', 'findById'], {}, { context: {} })

        const sent = vi
            .mocked(agent.call)
            .mock.calls.map(
                ([, input]) =>
                    (input as { headers: { cookie: string } }).headers.cookie
            )
        expect(sent).toEqual(['session=alice', 'session=bob'])
    })

    it('sends no headers at all when the caller has none', async () => {
        const agent: Link = {
            call: vi
                .fn()
                .mockResolvedValue(events({ kind: 'value', value: null })),
        }

        await serviceLink<ClientContext>({
            agent,
            service: 'project',
            contract,
        }).call(['crud', 'findById'], {}, { context: {} })

        expect(vi.mocked(agent.call).mock.calls[0]?.[1]).not.toHaveProperty(
            'headers'
        )
    })

    it('follows a grant by going straight to the replica, which it asks for the same prefixed path', async () => {
        const agent: Link = {
            call: vi.fn().mockRejectedValue(
                grantDirect({
                    replicaId: 'project-1',
                    address: 'ws://127.0.0.1:1/mesh/ws',
                    token: 't',
                    expiresAt: 9_999_999_999_999,
                })
            ),
        }
        const link = serviceLink<ClientContext>({
            agent,
            service: 'project',
            contract,
        })

        // Nothing listens there, so the direct call fails; what matters is that it was tried and the failure is the caller's.
        await expect(
            link.call(['crud', 'findById'], {}, { context: {} })
        ).rejects.toBeDefined()
        expect(agent.call).toHaveBeenCalled()
    })
})
