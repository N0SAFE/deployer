import { describe, expect, it } from 'vitest'

import type { MeshNodeSecret } from '@deployer/node-agent-contracts'

import {
    adoptionOf,
    fingerprintOf,
    secretInventoryOf,
} from './secret-inventory'

const secret = (
    id: MeshNodeSecret['id'],
    fingerprint: string | null,
    adoptedAt: string | null = null
): MeshNodeSecret => ({ id, purpose: 'p', fingerprint, adoptedAt, consumers: [] })

describe('fingerprintOf', () => {
    it('is stable, short, and not the secret', () => {
        const value = 'a-long-random-platform-secret-0123456789'
        expect(fingerprintOf(value)).toBe(fingerprintOf(value))
        expect(fingerprintOf(value)).toMatch(/^[0-9a-f]{12}$/)
        expect(fingerprintOf(value)).not.toContain(value)
        expect(fingerprintOf(`${value}x`)).not.toBe(fingerprintOf(value))
    })
})

describe('secretInventoryOf', () => {
    it('lists both secrets with what reads them, and never a value', () => {
        const inventory = secretInventoryOf({
            meshSharedSecret: 'mesh-value',
            meshSharedSecretUpdatedAt: '2026-11-05T10:00:00.000Z',
            platformSecret: 'platform-value',
            platformSecretUpdatedAt: '2026-11-05T10:01:00.000Z',
        } as never)

        expect(inventory.map((entry) => entry.id)).toEqual(['mesh', 'platform'])
        expect(JSON.stringify(inventory)).not.toContain('mesh-value')
        expect(JSON.stringify(inventory)).not.toContain('platform-value')
        expect(inventory[1]).toMatchObject({
            adoptedAt: '2026-11-05T10:01:00.000Z',
            consumers: expect.arrayContaining(['Better Auth sessions', 'column encryption']),
        })
    })

    it('says "none held" for an unconfigured node or an empty column', () => {
        for (const config of [null, { meshSharedSecret: '', platformSecret: null } as never]) {
            expect(secretInventoryOf(config).map((entry) => entry.fingerprint)).toEqual([
                null,
                null,
            ])
        }
    })
})

describe('adoptionOf', () => {
    it('marks every node current when they hold the same value', () => {
        const [platform] = adoptionOf([
            { nodeId: 'a', secrets: [secret('platform', 'f1')] },
            { nodeId: 'b', secrets: [secret('platform', 'f1')] },
        ])
        expect(platform?.current).toBe('f1')
        expect(platform?.nodes.map((node) => node.status)).toEqual(['current', 'current'])
    })

    it('flags the node that disagrees with the majority, and the one with none', () => {
        const [platform] = adoptionOf([
            { nodeId: 'a', secrets: [secret('platform', 'f1')] },
            { nodeId: 'b', secrets: [secret('platform', 'f1')] },
            { nodeId: 'c', secrets: [secret('platform', 'f0')] },
            { nodeId: 'd', secrets: [] },
        ])
        expect(Object.fromEntries(platform?.nodes.map((node) => [node.nodeId, node.status]) ?? [])).toEqual({
            a: 'current',
            b: 'current',
            c: 'stale',
            d: 'missing',
        })
    })

    it('breaks a tie toward the most recently adopted value', () => {
        const [platform] = adoptionOf([
            { nodeId: 'a', secrets: [secret('platform', 'old', '2026-11-01T00:00:00.000Z')] },
            { nodeId: 'b', secrets: [secret('platform', 'new', '2026-11-05T00:00:00.000Z')] },
        ])
        expect(platform?.current).toBe('new')
        expect(platform?.nodes.find((node) => node.nodeId === 'a')?.status).toBe('stale')
    })

    it('has no current value when no node holds one', () => {
        const [mesh] = adoptionOf([{ nodeId: 'a', secrets: [secret('mesh', null)] }])
        expect(mesh?.current).toBeNull()
        expect(mesh?.nodes[0]?.status).toBe('missing')
    })
})
