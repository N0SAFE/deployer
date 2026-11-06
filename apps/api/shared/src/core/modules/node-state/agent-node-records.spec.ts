import { Cause, Effect, Exit } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import {
    agentNodeRecords,
    nodeConfigRowFromRecord,
    nodeRecordPatchFromRow,
} from './agent-node-records'

import type { NodeRecordConfig } from '../mesh/services/node-record.client'
import type { ClientContext, ClientLink } from '@orpc/client'

async function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
    const exit = await Effect.runPromiseExit(effect)
    if (Exit.isSuccess(exit)) return exit.value
    throw Cause.squash(exit.cause)
}

const CONFIG: NodeRecordConfig = {
    nodeId: '0192f5c1-8f3b-4f2e-9a4d-2b7c1d3e5f60',
    strategy: 'local',
    setupState: 'setup_done',
    deployerVersion: '1.2.3',
    upgradedAtVersion: null,
    databaseUrl: 'postgres://db',
    databaseProvisioning: 'local',
    meshUrlsSnapshot: ['ws://peer'],
    swarmConfig: {
        mode: 'create',
        policy: 'auto',
        advertiseAddr: null,
        joinToken: null,
        joinAddrs: [],
    },
    peerServiceToken: null,
    peerServiceTokenExpiresAt: null,
    meshSharedSecret: 'secret',
    meshSharedSecretUpdatedAt: '2026-10-30T10:00:00.000Z',
    platformSecret: 'platform',
    platformSecretUpdatedAt: '2026-10-30T10:00:00.000Z',
    platformSecretGeneration: 2,
    platformSecretPrevious: [{ generation: 1, value: 'old' }],
    scanConfig: { autoScan: true, scanners: ['trivy'] },
    mesh: null,
    postSetupFlags: { scanning: 'dismissed' },
    configuredAt: '2026-10-30T10:00:00.000Z',
    updatedAt: '2026-10-30T11:00:00.000Z',
}

const RECORD = { agentId: 'node-agent-a', configured: true, config: CONFIG }

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

describe('nodeConfigRowFromRecord', () => {
    it("carries the agent's record into the row the API reads", () => {
        expect(nodeConfigRowFromRecord(CONFIG)).toEqual({
            id: 1,
            nodeId: CONFIG.nodeId,
            strategy: 'local',
            setupState: 'setup_done',
            deployerVersion: '1.2.3',
            upgradedAtVersion: null,
            meshUrlsSnapshot: ['ws://peer'],
            databaseUrl: 'postgres://db',
            databaseProvisioning: 'local',
            configuredAt: '2026-10-30T10:00:00.000Z',
            peerServiceToken: null,
            peerServiceTokenExpiresAt: null,
            updatedAt: '2026-10-30T11:00:00.000Z',
            meshSharedSecret: 'secret',
            meshSharedSecretUpdatedAt: '2026-10-30T10:00:00.000Z',
            platformSecret: 'platform',
            platformSecretUpdatedAt: '2026-10-30T10:00:00.000Z',
            platformSecretGeneration: 2,
            platformSecretPrevious: [{ generation: 1, value: 'old' }],
            scanConfig: { autoScan: true, scanners: ['trivy'] },
            postSetupFlags: { scanning: 'dismissed' },
            swarmConfig: CONFIG.swarmConfig,
        })
    })

    it('reports an unconfigured record as no answer, so the local file stays the source', () => {
        expect(nodeConfigRowFromRecord({ ...CONFIG, nodeId: null })).toBeNull()
    })
})

describe('nodeRecordPatchFromRow', () => {
    it('writes the row as a patch, leaving id and the timestamps to the agent', () => {
        const row = nodeConfigRowFromRecord(CONFIG)
        if (row === null)
            throw new Error('the fixture record must map to a row')

        const patch = nodeRecordPatchFromRow(row)

        expect(patch).toMatchObject({
            nodeId: CONFIG.nodeId,
            strategy: 'local',
            setupState: 'setup_done',
            databaseUrl: 'postgres://db',
            meshUrlsSnapshot: ['ws://peer'],
            swarmConfig: { mode: 'create' },
            meshSharedSecret: 'secret',
            scanConfig: { autoScan: true, scanners: ['trivy'] },
        })
        expect(patch).not.toHaveProperty('id')
        expect(patch).not.toHaveProperty('configuredAt')
        expect(patch).not.toHaveProperty('updatedAt')
    })
})

describe('agentNodeRecords', () => {
    it('reads the record through the injected link', async () => {
        const link = answering(RECORD)

        expect((await run(agentNodeRecords({ link }).read()))?.nodeId).toBe(
            CONFIG.nodeId
        )
        expect(link.call).toHaveBeenCalledWith(
            ['node', 'state'],
            expect.anything(),
            expect.anything()
        )
    })

    it('is silent (null, not a failure) when the agent does not answer', async () => {
        expect(
            await run(
                agentNodeRecords({
                    link: answering(null, new Error('No procedure matched')),
                }).read()
            )
        ).toBeNull()
        expect(
            await run(
                agentNodeRecords({
                    link: answering({
                        agentId: 'a',
                        configured: false,
                        config: null,
                    }),
                }).read()
            )
        ).toBeNull()
    })

    it("writes the patch through the agent's configure procedure", async () => {
        const call = vi.fn((_path: unknown, _patch: unknown) =>
            Promise.resolve(RECORD)
        )
        const link = { call } as unknown as ClientLink<ClientContext>
        const row = nodeConfigRowFromRecord(CONFIG)
        if (row === null)
            throw new Error('the fixture record must map to a row')

        const written = await run(agentNodeRecords({ link }).write(row))

        expect(written?.nodeId).toBe(CONFIG.nodeId)
        expect(call.mock.calls[0]?.[0]).toEqual(['node', 'configure'])
        const patch = call.mock.calls[0]?.[1] as Record<string, unknown>
        expect(patch).not.toHaveProperty('id')
        expect(patch).not.toHaveProperty('configuredAt')
        expect(patch).not.toHaveProperty('updatedAt')
    })
})
