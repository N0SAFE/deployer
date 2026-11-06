import { Cause, Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'

import { provideTo } from '@deployer/effect-core'
import type { NodeDoorFleetSecrets } from '@deployer/mesh-client'

import {
    SecretInventory,
    SecretInventoryUnavailable,
    SecretRotationNotAllowed,
} from './secret-inventory.service'
import { SecretsDoor, type SecretsDoorShape } from './secrets.ports'

const fleet: NodeDoorFleetSecrets = {
    nodes: [
        {
            nodeId: 'a',
            reachable: true,
            secrets: [
                {
                    id: 'platform',
                    purpose: 'p',
                    fingerprint: 'f1',
                    generation: 1,
                    earlierGenerations: [],
                    adoptedAt: null,
                    consumers: ['Better Auth sessions'],
                },
            ],
        },
        { nodeId: 'b', reachable: false, secrets: [] },
    ],
    adoption: [
        {
            id: 'platform',
            current: 'f1',
            currentGeneration: 1,
            nodes: [{ nodeId: 'a', fingerprint: 'f1', generation: 1, adoptedAt: null, status: 'current' }],
        },
    ],
}

const absent = { kind: 'absent' } as const

const serviceOver = (door: Partial<SecretsDoorShape>) =>
    provideTo(SecretInventory.live, (effect) =>
        effect.pipe(
            Effect.provideService(SecretsDoor, {
                fleetSecrets: () => Effect.succeed(null),
                rotate: () => Effect.succeed(absent),
                retire: () => Effect.succeed(absent),
                ...door,
            })
        ) as Effect.Effect<unknown>
    )

const inventoryFor = (answer: NodeDoorFleetSecrets | null) =>
    serviceOver({ fleetSecrets: () => Effect.succeed(answer) }).inventory()

describe('SecretInventory', () => {
    it('serves what the agent says about the fleet, an unreachable node included', async () => {
        const result = await Effect.runPromise(inventoryFor(fleet))

        expect(result.nodes.map((node) => [node.nodeId, node.reachable])).toEqual([
            ['a', true],
            ['b', false],
        ])
        expect(result.adoption[0]?.current).toBe('f1')
    })

    it('fails with a typed error when there is no agent to ask, instead of listing an empty fleet', async () => {
        const exit = await Effect.runPromiseExit(inventoryFor(null))

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
            expect(Cause.squash(exit.cause)).toBeInstanceOf(SecretInventoryUnavailable)
        }
    })
})

describe('SecretInventory rotation', () => {
    it('answers the generation that is current after a rotation', async () => {
        const service = serviceOver({
            rotate: () => Effect.succeed({ kind: 'ok', value: { generation: 4 } }),
        })

        expect(await Effect.runPromise(service.rotate())).toEqual({ generation: 4 })
    })

    it("carries the agent's own reason when it refuses, as a typed conflict", async () => {
        const service = serviceOver({
            retire: () =>
                Effect.succeed({ kind: 'refused', message: 'Not every node has taken in the current generation yet (b).' }),
        })

        const exit = await Effect.runPromiseExit(service.retire(1))

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause)
            expect(error).toBeInstanceOf(SecretRotationNotAllowed)
            expect((error as SecretRotationNotAllowed).publicMessage()).toContain('Not every node')
        }
    })

    it('says plainly when there is no agent to ask', async () => {
        const exit = await Effect.runPromiseExit(serviceOver({}).rotate())

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
            expect(Cause.squash(exit.cause)).toBeInstanceOf(SecretInventoryUnavailable)
        }
    })
})
