import { Cause, Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'

import { provideTo } from '@deployer/effect-core'
import type { NodeDoorFleetSecrets } from '@deployer/mesh-client'

import { SecretInventory, SecretInventoryUnavailable } from './secret-inventory.service'
import { SecretsDoor } from './secrets.ports'

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

const inventoryFor = (answer: NodeDoorFleetSecrets | null) =>
    provideTo(SecretInventory.live, (effect) =>
        effect.pipe(
            Effect.provideService(SecretsDoor, {
                fleetSecrets: () => Effect.succeed(answer),
            })
        ) as Effect.Effect<unknown>
    ).inventory()

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
