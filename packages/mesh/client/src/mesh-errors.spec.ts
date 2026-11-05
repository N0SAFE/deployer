import { describe, expect, it } from 'vitest'

import {
    MESH_DIRECT,
    MESH_REDIRECT,
    grantDirect,
    readDirectGrant,
    readRedirect,
    redirectTo,
} from '@deployer/node-agent-contracts'

const grant = {
    replicaId: 'runtime-2',
    address: 'ws://10.0.0.2:3105',
    token: 'signed',
    expiresAt: 9_000,
}

describe('mesh error codes', () => {
    it('carries the replica a redirect names', () => {
        const error = redirectTo('project-3', 'holds deployment 7')

        expect(error).toMatchObject({ code: MESH_REDIRECT })
        expect(readRedirect(error)).toEqual({
            replicaId: 'project-3',
            reason: 'holds deployment 7',
        })
    })

    it('carries the grant a direct answer names', () => {
        const error = grantDirect(grant)

        expect(error).toMatchObject({ code: MESH_DIRECT })
        expect(readDirectGrant(error)).toEqual(grant)
    })

    it('reads the wire shape, so a rebuilt error is understood', () => {
        expect(readDirectGrant({ code: MESH_DIRECT, data: grant })).toEqual(
            grant
        )
    })

    it('does not mistake one code for the other, or for any other error', () => {
        expect(readRedirect(grantDirect(grant))).toBeUndefined()
        expect(readDirectGrant(redirectTo('a', 'b'))).toBeUndefined()
        expect(readDirectGrant(new Error('boom'))).toBeUndefined()
        expect(
            readDirectGrant({ code: MESH_DIRECT, data: { replicaId: 'x' } })
        ).toBeUndefined()
        expect(readRedirect(undefined)).toBeUndefined()
    })
})
