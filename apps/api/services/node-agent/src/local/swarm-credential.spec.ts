import { DatabaseSync } from 'node:sqlite'

import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { AgentStore, agentStoreOver } from './agent-store'
import { swarmCredentialFrom } from './swarm-credential'

const store = () => agentStoreOver(new DatabaseSync(':memory:') as never)
const run = <A, E>(effect: Effect.Effect<A, E, AgentStore>, over = store()) =>
    Effect.runPromise(effect.pipe(Effect.provideService(AgentStore, over)))

describe('SwarmCredential verify', () => {
    it('accepts the current secret and nothing else', async () => {
        const credential = swarmCredentialFrom({
            secret: 'current-secret',
            swarmId: 'swarm-1',
        })

        expect(credential.verify('current-secret')).toBe(true)
        expect(credential.verify('unknown-secret')).toBe(false)
        expect(credential.verify('')).toBe(false)
        expect(credential.verify(undefined)).toBe(false)
    })

    it('accepts the previous secret inside its window and refuses it after', async () => {
        const over = store()
        await run(over.installCredential('first-secret', 'swarm-1'))
        const credential = swarmCredentialFrom({
            secret: 'first-secret',
            swarmId: 'swarm-1',
        })

        await run(
            credential.rotateTo('second-secret', Date.now() + 60_000, 1_000),
            over
        )
        expect(credential.current()).toBe('second-secret')
        expect(credential.previous()).toBe('first-secret')
        expect(credential.verify('second-secret')).toBe(true)
        // The grace window: a peer still on the old secret opens its connection.
        expect(credential.verify('first-secret')).toBe(true)

        // Rotating again moves the window: `second-secret` is now the previous one, already expired.
        await run(
            credential.rotateTo('third-secret', Date.now() - 1, 2_000),
            over
        )
        expect(credential.verify('third-secret')).toBe(true)
        expect(credential.verify('second-secret')).toBe(false)
        expect(credential.verify('first-secret')).toBe(false)
    })
})

describe('SwarmCredential rotate', () => {
    it('mints a secret, stores it, and keeps the old one as previous', async () => {
        const over = store()
        await run(over.installCredential('first-secret', 'swarm-1'))
        const credential = swarmCredentialFrom({
            secret: 'first-secret',
            swarmId: 'swarm-1',
        })

        const rotation = await run(credential.rotate(), over)

        expect(rotation.secret).not.toBe('first-secret')
        expect(rotation.secret.length).toBeGreaterThanOrEqual(40)
        expect(rotation.validUntil).toBeGreaterThan(Date.now())
        expect(rotation.epoch).toBeGreaterThan(0)
        expect(credential.current()).toBe(rotation.secret)
        expect(credential.previous()).toBe('first-secret')
        expect(await run(over.credential())).toMatchObject({
            secret: rotation.secret,
            previousSecret: 'first-secret',
        })
    })
})

describe('SwarmCredential adopt', () => {
    it('ignores a rotation whose epoch is not ahead of the one in force', async () => {
        const over = store()
        await run(over.installCredential('first-secret', 'swarm-1'))
        const credential = swarmCredentialFrom({
            secret: 'first-secret',
            swarmId: 'swarm-1',
            installedAt: 1_000,
        })

        await run(
            credential.adopt('same-epoch', Date.now() + 60_000, 1_000),
            over
        )
        await run(
            credential.adopt('older-epoch', Date.now() + 60_000, 999),
            over
        )

        expect(credential.current()).toBe('first-secret')
        expect(credential.epoch()).toBe(1_000)
    })

    it('adopts a newer rotation, with its epoch, and keeps the old secret as previous', async () => {
        const over = store()
        await run(over.installCredential('first-secret', 'swarm-1'))
        const credential = swarmCredentialFrom({
            secret: 'first-secret',
            swarmId: 'swarm-1',
            installedAt: 1_000,
        })

        await run(
            credential.adopt('peer-secret', Date.now() + 60_000, 5_000),
            over
        )

        expect(credential.current()).toBe('peer-secret')
        expect(credential.previous()).toBe('first-secret')
        expect(credential.epoch()).toBe(5_000)
        // The epoch is durable: a restart does not re-open a rotation it already took.
        expect(await run(over.credential())).toMatchObject({
            secret: 'peer-secret',
            installedAt: 5_000,
        })
        await run(
            credential.adopt('stale-secret', Date.now() + 60_000, 5_000),
            over
        )
        expect(credential.current()).toBe('peer-secret')
    })
})
