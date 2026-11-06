import { Cause, Effect, Exit } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { provideTo } from '@deployer/effect-core'
import type { NodeDoorFleetSecrets } from '@deployer/mesh-client'

import {
    SecretInventory,
    SecretInventoryUnavailable,
    SecretRotationNotAllowed,
    StoredSecretsUnavailable,
} from './secret-inventory.service'
import {
    SecretsDoor,
    StoredSecretsPort,
    type SecretsDoorShape,
    type StoredSecretsShape,
} from './secrets.ports'

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

const nothingStored: StoredSecretsShape = {
    report: () => Effect.succeed({ totals: {}, columns: [] }),
}

const serviceOver = (
    door: Partial<SecretsDoorShape>,
    stored: StoredSecretsShape = nothingStored
) =>
    provideTo(new SecretInventory.live(), (effect) =>
        effect.pipe(
            Effect.provideService(StoredSecretsPort, stored),
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

describe('SecretInventory: the stored values', () => {
    const storedUnder = (totals: Record<string, number>): StoredSecretsShape => ({
        report: () =>
            Effect.succeed({
                totals,
                columns: [{ table: 'github_apps', column: 'private_key', byKey: totals }],
            }),
    })

    it('serves the counts by key', async () => {
        const service = serviceOver({}, storedUnder({ 'column:1': 2, 'column:2': 5 }))

        const result = await Effect.runPromise(service.stored())

        expect(result.totals).toEqual({ 'column:1': 2, 'column:2': 5 })
        expect(result.columns[0]).toMatchObject({ table: 'github_apps', column: 'private_key' })
    })

    it('refuses to retire a generation that still holds rows, and does not ask the agent', async () => {
        const retire = vi.fn(() => Effect.succeed({ kind: 'absent' as const }))
        const service = serviceOver({ retire }, storedUnder({ 'column:1': 3, 'column:2': 5 }))

        const exit = await Effect.runPromiseExit(service.retire(1))

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause)
            expect(error).toBeInstanceOf(SecretRotationNotAllowed)
            expect((error as SecretRotationNotAllowed).publicMessage()).toContain('3 stored value(s)')
        }
        expect(retire).not.toHaveBeenCalled()
    })

    it('retires a generation no row is sealed under any more', async () => {
        const service = serviceOver(
            {
                retire: () =>
                    Effect.succeed({
                        kind: 'ok' as const,
                        value: { generation: 2, reached: ['b'], unreachable: [] },
                    }),
            },
            storedUnder({ 'column:2': 5 })
        )

        expect(await Effect.runPromise(service.retire(1))).toMatchObject({ generation: 2, reached: ['b'] })
    })

    it('fails closed when the rows cannot be counted: retiring on a guess could lose data', async () => {
        const service = serviceOver({}, { report: () => Effect.fail(new Error('db down')) })

        const exit = await Effect.runPromiseExit(service.retire(1))

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
            expect(Cause.squash(exit.cause)).toBeInstanceOf(StoredSecretsUnavailable)
        }
    })
})
