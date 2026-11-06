import { describe, expect, it, vi } from 'vitest'

import {
    readNodeRecord,
    readPlatformNodeId,
    writeNodeRecord,
} from './node-record.client'

import type { ClientContext, ClientLink } from '@orpc/client'

const RECORD = {
    agentId: 'node-agent-a',
    configured: true,
    config: {
        nodeId: '0192f5c1-8f3b-4f2e-9a4d-2b7c1d3e5f60',
        strategy: 'local',
        setupState: 'setup_done',
        deployerVersion: '1.2.3',
        upgradedAtVersion: null,
        meshUrlsSnapshot: ['ws://peer'],
        databaseUrl: 'postgres://db',
        databaseProvisioning: 'local',
        swarmConfig: null,
        peerServiceToken: null,
        peerServiceTokenExpiresAt: null,
        scanConfig: null,
        postSetupFlags: null,
        configuredAt: '2026-10-30T10:00:00.000Z',
        updatedAt: '2026-10-30T11:00:00.000Z',
    },
}

/** A link that answers the one procedure with `answer`, or rejects with `error`. */
const answering = (
    answer: unknown,
    error?: Error
): ClientLink<ClientContext> => ({
    call: vi.fn(
        error === undefined
            ? () => Promise.resolve(answer)
            : () => Promise.reject(error)
    ),
})

describe('readNodeRecord', () => {
    it("reads the node's record from its agent over the node door", async () => {
        const link = answering(RECORD)

        await expect(readNodeRecord({ link })).resolves.toEqual(RECORD)
        expect(link.call).toHaveBeenCalledWith(
            ['node', 'state'],
            expect.anything(),
            expect.anything()
        )
    })

    it('returns null when the agent does not know the procedure, so the caller can fall back', async () => {
        const link = answering(null, new Error('No procedure matched'))

        await expect(readNodeRecord({ link })).resolves.toBeNull()
        await expect(readPlatformNodeId({ link })).resolves.toBeNull()
    })

    it('returns null when the node has no agent at all', async () => {
        await expect(
            readNodeRecord({ socketPath: '/tmp/opencode/no-such-agent.sock' })
        ).resolves.toBeNull()
    })

    it("writes a patch through the agent's configure procedure", async () => {
        const link = answering(RECORD)

        await expect(
            writeNodeRecord({ setupState: 'setup_done' }, { link })
        ).resolves.toEqual(RECORD)
        expect(link.call).toHaveBeenCalledWith(
            ['node', 'configure'],
            { setupState: 'setup_done' },
            expect.anything()
        )
    })

    it('reports the platform node id only once the node is configured', async () => {
        const unconfigured = {
            agentId: 'node-agent-a',
            configured: false,
            config: null,
        }

        expect(
            await readPlatformNodeId({ link: answering(unconfigured) })
        ).toBeNull()
        expect(await readPlatformNodeId({ link: answering(RECORD) })).toBe(
            RECORD.config.nodeId
        )
    })
})
