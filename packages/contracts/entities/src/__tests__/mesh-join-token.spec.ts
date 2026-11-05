import { describe, expect, it } from 'vitest'

import { meshEnrollmentEnrollResultSchema } from '../entities/mesh/enrollment.schema'
import {
    meshJoinGrantConsumeResultSchema,
    meshJoinGrantIssueResultSchema,
} from '../entities/mesh/trust.schema'
import { setupInitializeRemoteInputSchema } from '../entities/setup'

/**
 * `meshJoinToken` is additive: a producer that predates it keeps validating, and one that hands it out carries the
 * agent's own join token (the encoded one `roster.join` accepts) next to the platform's grant token.
 */
describe('mesh join token threading', () => {
    const grantId = '9f1b7a2e-0b4e-4f6a-9c1d-1f2e3d4c5b6a'
    const nodeId = '3c6d8e0f-1a2b-4c3d-8e9f-0a1b2c3d4e5f'

    it('issues a grant without an agent token (old payload still validates)', () => {
        const parsed = meshJoinGrantIssueResultSchema.parse({
            grantId,
            grantToken: 'platform-grant',
            expiresAt: '2026-10-30T12:00:00.000Z',
            status: 'issued',
        })
        expect(parsed.meshJoinToken).toBeNull()
    })

    it("issues a grant carrying the agent's join token", () => {
        const parsed = meshJoinGrantIssueResultSchema.parse({
            grantId,
            grantToken: 'platform-grant',
            expiresAt: '2026-10-30T12:00:00.000Z',
            status: 'issued',
            meshJoinToken: 'eyJ2IjoxfQ',
        })
        expect(parsed.meshJoinToken).toBe('eyJ2IjoxfQ')
    })

    it('consumes a grant without the field, and with it', () => {
        const base = {
            accepted: true,
            grantId,
            nodeId,
            enrolledAt: '2026-10-30T12:00:00.000Z',
            databaseUrl: 'postgres://db',
            peerServiceToken: null,
            peerServiceTokenExpiresAt: null,
            meshSharedSecret: null,
        }
        expect(
            meshJoinGrantConsumeResultSchema.parse(base).meshJoinToken
        ).toBeNull()
        expect(
            meshJoinGrantConsumeResultSchema.parse({
                ...base,
                meshJoinToken: 'tok',
            }).meshJoinToken
        ).toBe('tok')
    })

    it('enrolls without the field, and with it', () => {
        const base = {
            nodeId,
            enrolledAt: '2026-10-30T12:00:00.000Z',
            databaseUrl: 'postgres://db',
            swarmGrant: null,
        }
        expect(
            meshEnrollmentEnrollResultSchema.parse(base).meshJoinToken
        ).toBeNull()
        expect(
            meshEnrollmentEnrollResultSchema.parse({
                ...base,
                meshJoinToken: 'tok',
            }).meshJoinToken
        ).toBe('tok')
    })

    it('accepts a remote setup input with the platform grant alone, and with the agent token too', () => {
        const base = {
            strategy: 'remote' as const,
            token: 'platform-grant',
            serverUrl: 'https://node.example.com',
        }
        expect(
            setupInitializeRemoteInputSchema.parse(base).meshJoinToken
        ).toBeUndefined()
        expect(
            setupInitializeRemoteInputSchema.parse({
                ...base,
                meshJoinToken: 'agent-token',
            }).meshJoinToken
        ).toBe('agent-token')
    })
})
