import { describe, expect, it, vi } from 'vitest'

import { EnrollmentService, type EnrollmentPorts } from './enrollment.service'

const grant = {
    managerToken: null,
    workerToken: 'w',
    controlPlaneAddrs: ['10.0.0.1:2377'],
    role: 'worker' as const,
    reason: 'capacity',
}

function ports(over: Partial<EnrollmentPorts> = {}): EnrollmentPorts {
    return {
        version: '3.1.0',
        swarmGrant: vi.fn(() => Promise.resolve(grant)),
        checkToken: vi.fn(() => Promise.resolve(true)),
        databaseUrl: () => 'postgres://db/deployer',
        platformSecret: () =>
            Promise.resolve({
                generation: 2,
                value: 'fleet-platform-secret',
                previous: [{ generation: 1, value: 'older' }],
            }),
        register: vi.fn((input) =>
            Promise.resolve({
                nodeId: input.nodeId,
                enrolledAt: '2026-10-29T00:00:00.000Z',
            })
        ),
        ...over,
    }
}

const enrollInput = {
    token: 't',
    nodeId: 'node-b',
    serverUrl: 'https://b.example.test',
}

describe('EnrollmentService', () => {
    it('describes the fleet to a holder of a valid token', async () => {
        const p = ports()
        const service = new EnrollmentService(p)

        expect(await service.describe('t')).toEqual({
            version: '3.1.0',
            meshNetwork: null,
        })
        expect(p.checkToken).toHaveBeenCalledWith('t')
    })

    it('enrolls a node: registers it and answers the swarm role the fleet decides', async () => {
        const p = ports()
        const service = new EnrollmentService(p)

        const result = await service.enroll({
            ...enrollInput,
            requestedSwarmPolicy: 'auto',
        })

        expect(p.register).toHaveBeenCalledWith({
            nodeId: 'node-b',
            serverUrl: 'https://b.example.test',
            displayName: null,
        })
        expect(p.swarmGrant).toHaveBeenCalledWith('auto')
        expect(result).toEqual({
            nodeId: 'node-b',
            enrolledAt: '2026-10-29T00:00:00.000Z',
            databaseUrl: 'postgres://db/deployer',
            platformSecret: 'fleet-platform-secret',
            platformSecretGeneration: 2,
            platformSecretPrevious: [{ generation: 1, value: 'older' }],
            swarmGrant: grant,
            meshJoinToken: 't',
        })
    })

    it('refuses a token its agent does not vouch for, and registers nothing', async () => {
        const p = ports({ checkToken: vi.fn(() => Promise.resolve(false)) })
        const service = new EnrollmentService(p)

        await expect(service.enroll(enrollInput)).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
        })
        await expect(service.describe('t')).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
        })
        expect(p.register).not.toHaveBeenCalled()
    })

    it('enrolls no one when it has no agent to vouch for the token', async () => {
        await expect(
            new EnrollmentService(
                ports({ checkToken: vi.fn(() => Promise.resolve(null)) })
            ).enroll(enrollInput)
        ).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
        })
    })

    it('refuses to enroll before it has a platform secret to hand over', async () => {
        const p = ports({ platformSecret: () => Promise.resolve(null) })

        await expect(
            new EnrollmentService(p).enroll(enrollInput)
        ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
        expect(p.register).not.toHaveBeenCalled()
    })

    it('refuses to enroll before it has a database to hand over', async () => {
        const p = ports({ databaseUrl: () => null })

        await expect(
            new EnrollmentService(p).enroll(enrollInput)
        ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
        expect(p.register).not.toHaveBeenCalled()
    })

    it('hands the agent join token back to the joiner it admitted with it', async () => {
        const result = await new EnrollmentService(ports()).enroll(enrollInput)

        expect(result.meshJoinToken).toBe('t')
    })
})
