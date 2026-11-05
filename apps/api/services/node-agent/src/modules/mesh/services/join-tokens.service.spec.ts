import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { decodeJoinToken, encodeJoinToken } from '../../../local/join-token'
import { meshFixture } from '../testing/mesh.fixtures'

import { MeshDirectory } from './directory.service'
import { JoinTokens } from './join-tokens.service'
import { PendingSeeds } from './pending-seeds.service'
import { RosterGossip } from './roster-gossip.service'

describe('JoinTokens revocation', () => {
    it('makes a token unusable before it expires, for both check and join', async () => {
        const a = meshFixture({
            nodeId: 'A',
            now: 1_000,
            advertise: 'ws://a',
            secret: 'a-secret',
        })
        const { token } = await a.run(new JoinTokens.live().issue(60_000))
        expect(await a.run(new JoinTokens.live().check(token))).toBe(true)

        expect(await a.run(new JoinTokens.live().revoke(token))).toEqual({
            revoked: true,
        })
        expect(await a.run(new JoinTokens.live().check(token))).toBe(false)

        const outcome = await a.settle(new JoinTokens.live().redeem(token))
        expect(outcome).toMatchObject({
            error: { _tag: 'MeshJoinRejected', reason: 'revoked' },
        })
    })

    it('revokes only the token it was given', async () => {
        const a = meshFixture({
            nodeId: 'A',
            now: 1_000,
            advertise: 'ws://a',
            secret: 'a-secret',
        })
        const first = await a.run(new JoinTokens.live().issue(60_000))
        const second = await a.run(new JoinTokens.live().issue(60_000))

        await a.run(new JoinTokens.live().revoke(first.token))

        expect(await a.run(new JoinTokens.live().check(first.token))).toBe(
            false
        )
        expect(await a.run(new JoinTokens.live().check(second.token))).toBe(
            true
        )
    })
})

describe('JoinTokens', () => {
    describe('issue', () => {
        it('makes a standalone agent the first node of a new swarm, under its own credential', async () => {
            const a = meshFixture({
                nodeId: 'A',
                now: 1_000,
                advertise: 'ws://a',
                secret: 'a-standalone-secret',
            })
            expect(a.credential.swarmId()).toBeNull()

            const { token, expiresAt } = await a.run(
                new JoinTokens.live().issue(60_000)
            )
            const decoded = decodeJoinToken(token, 2_000)

            expect(expiresAt).toBe(61_000)
            expect(decoded).toMatchObject({
                ok: true,
                token: {
                    address: 'ws://a',
                    secret: 'a-standalone-secret',
                    expiresAt: 61_000,
                },
            })
            expect(a.credential.swarmId()).toMatch(/^swarm-/)
            expect(
                (await Effect.runPromise(a.store.credential())).swarmId
            ).toBe(a.credential.swarmId())
        })

        it('keeps the same swarm for every token after the first', async () => {
            const a = meshFixture({ nodeId: 'A', advertise: 'ws://a' })

            const first = await a.run(new JoinTokens.live().issue(60_000))
            const second = await a.run(new JoinTokens.live().issue(60_000))

            const swarmOf = (token: string) =>
                (decodeJoinToken(token, 0) as { token: { swarmId: string } })
                    .token.swarmId
            expect(swarmOf(first.token)).toBe(swarmOf(second.token))
        })
    })

    describe('check', () => {
        it("accepts a token of this swarm and refuses another swarm's, an expired one and garbage", async () => {
            const a = meshFixture({
                nodeId: 'A',
                now: 1_000,
                advertise: 'ws://a',
                secret: 'the-swarm-secret',
                swarmId: 'swarm-1',
            })
            const token = (
                over: Partial<{
                    secret: string
                    swarmId: string
                    expiresAt: number
                }> = {}
            ) =>
                encodeJoinToken({
                    jti: `jti-${String(Math.random())}`,
                    address: 'ws://a',
                    secret: 'the-swarm-secret',
                    swarmId: 'swarm-1',
                    expiresAt: 100_000,
                    ...over,
                })

            expect(await a.run(new JoinTokens.live().check(token()))).toBe(true)
            expect(
                await a.run(
                    new JoinTokens.live().check(token({ secret: 'other' }))
                )
            ).toBe(false)
            expect(
                await a.run(
                    new JoinTokens.live().check(token({ swarmId: 'swarm-2' }))
                )
            ).toBe(false)
            expect(
                await a.run(
                    new JoinTokens.live().check(token({ expiresAt: 500 }))
                )
            ).toBe(false)
            expect(
                await a.run(new JoinTokens.live().check('not-a-token'))
            ).toBe(false)
        })
    })

    describe('redeem', () => {
        const issuedBy = (swarmId = 'swarm-1') =>
            encodeJoinToken({
                jti: `jti-${swarmId}`,
                address: 'ws://a',
                secret: 'the-swarm-secret',
                swarmId,
                expiresAt: 100_000,
            })

        it("adopts the swarm's credential and remembers the seed, so a restart rejoins by itself", async () => {
            const b = meshFixture({
                nodeId: 'B',
                now: 1_000,
                advertise: 'ws://b',
                secret: 'b-standalone-secret',
            })

            const result = await b.settle(
                new JoinTokens.live().redeem(issuedBy())
            )

            expect(result).toMatchObject({
                value: { swarmId: 'swarm-1', reached: false },
            })
            expect(b.credential.current()).toBe('the-swarm-secret')
            expect(b.credential.swarmId()).toBe('swarm-1')
            expect(await Effect.runPromise(b.store.credential())).toMatchObject(
                { secret: 'the-swarm-secret', swarmId: 'swarm-1' }
            )
            expect(await Effect.runPromise(b.store.seeds())).toEqual(['ws://a'])
        })

        it('installs the credential before it connects, so the first connection already carries it', async () => {
            const seen: string[] = []
            const a = meshFixture({
                nodeId: 'A',
                advertise: 'ws://a',
                secret: 'the-swarm-secret',
                swarmId: 'swarm-1',
            })
            const b = meshFixture({
                nodeId: 'B',
                now: 1_000,
                advertise: 'ws://b',
                secret: 'b-standalone-secret',
                addresses: {
                    'ws://a': {
                        call: (_path, input) => {
                            seen.push(b.credential.current())
                            return a.run(
                                new RosterGossip.live().exchange(input as never)
                            )
                        },
                    },
                },
            })

            await b.run(new JoinTokens.live().redeem(issuedBy()))

            expect(seen).toEqual(['the-swarm-secret'])
        })

        it('merges what the node holds with what the swarm knows, losing nothing', async () => {
            const a = meshFixture({
                nodeId: 'A',
                advertise: 'ws://a',
                secret: 'the-swarm-secret',
                swarmId: 'swarm-1',
            })
            await a.seed({
                service: 'runtime',
                replicaId: 'runtime-a',
                nodeId: 'A',
                address: 'ws://ra',
                load: 0.1,
                keys: [],
                generation: 1,
                expiresAt: 99_999,
            })
            const b = meshFixture({
                nodeId: 'B',
                now: 1_000,
                advertise: 'ws://b',
                addresses: {
                    'ws://a': {
                        call: (_path, input) =>
                            a.run(
                                new RosterGossip.live().exchange(input as never)
                            ),
                    },
                },
            })
            await b.seed({
                service: 'runtime',
                replicaId: 'runtime-b',
                nodeId: 'B',
                address: 'ws://rb',
                load: 0.2,
                keys: [],
                generation: 1,
                expiresAt: 99_999,
            })

            const result = await b.run(new JoinTokens.live().redeem(issuedBy()))

            expect(result).toMatchObject({ reached: true, learned: true })
            expect(
                (await b.run(new MeshDirectory.live().snapshot()))
                    .map((record) => record.replicaId)
                    .sort()
            ).toEqual(['runtime-a', 'runtime-b'])
            expect(
                await b.run(
                    Effect.flatMap(PendingSeeds, (seeds) => seeds.pending())
                )
            ).toEqual([])
        })

        it('rejects a token that is not one of ours, and an expired one, without touching the credential', async () => {
            const b = meshFixture({
                nodeId: 'B',
                now: 200_000,
                secret: 'b-standalone-secret',
            })

            expect(
                await b.settle(new JoinTokens.live().redeem('not-a-token'))
            ).toMatchObject({
                error: { _tag: 'MeshJoinRejected', reason: 'malformed' },
            })
            expect(
                await b.settle(new JoinTokens.live().redeem(issuedBy()))
            ).toMatchObject({
                error: { _tag: 'MeshJoinRejected', reason: 'expired' },
            })
            expect(b.credential.current()).toBe('b-standalone-secret')
            expect(await Effect.runPromise(b.store.seeds())).toEqual([])
        })
    })
})
