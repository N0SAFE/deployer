import { ORPCError, type ClientContext, type ClientLink } from '@orpc/client'
import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import {
    type MeshRelayEvent,
    type MeshRelayInput,
    grantDirect,
    readDirectGrant,
    redirectTo,
} from '@deployer/node-agent-contracts'

import { verifyLease } from '../rules/lease-token'
import {
    LEASE_SECRET,
    meshFixture,
    replicaRecord,
} from '../testing/mesh.fixtures'

import { MeshRelay, relayEvents } from './relay.service'

type Link = ClientLink<ClientContext>

const request = (overrides: Partial<MeshRelayInput> = {}): MeshRelayInput => ({
    service: 'runtime',
    path: ['logs', 'list'],
    input: { id: 1 },
    ...overrides,
})

const runtime = (replicaId: string, nodeId: string, overrides = {}) =>
    replicaRecord({ service: 'runtime', replicaId, nodeId, ...overrides })
const answering = (value: unknown): Link => ({
    call: vi.fn().mockResolvedValue(value),
})

async function* streamOf<T>(...values: T[]): AsyncGenerator<T> {
    for (const value of values) {
        await Promise.resolve()
        yield value
    }
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
    const all: T[] = []
    for await (const item of source) {
        all.push(item)
    }
    return all
}

describe('MeshRelay', () => {
    describe('brokering', () => {
        it("calls the replica on its own node with the procedure's path and input, and returns its answer", async () => {
            const local = answering({ lines: 3 })
            const remote = answering('never')
            const mesh = meshFixture({
                nodeId: 'A',
                replicas: { 'runtime-1': local, 'runtime-2': remote },
            })
            await mesh.seed(
                runtime('runtime-1', 'A'),
                runtime('runtime-2', 'B')
            )

            const result = await mesh.settle(
                new MeshRelay.live().relay(request())
            )

            expect(result).toEqual({
                value: { kind: 'value', value: { lines: 3 } },
            })
            expect(local.call).toHaveBeenCalledWith(
                ['logs', 'list'],
                { id: 1 },
                { context: { headers: {} } }
            )
            expect(remote.call).not.toHaveBeenCalled()
        })

        it('answers a redirect itself and replays the call on the replica it names', async () => {
            const first = {
                call: vi
                    .fn()
                    .mockRejectedValue(
                        redirectTo('runtime-3', 'holds stream-1')
                    ),
            }
            const owner = answering('served by runtime-3')
            const mesh = meshFixture({
                nodeId: 'A',
                replicas: { 'runtime-1': first, 'runtime-3': owner },
            })
            await mesh.seed(
                runtime('runtime-1', 'A'),
                runtime('runtime-3', 'C')
            )

            const result = await mesh.settle(
                new MeshRelay.live().relay(request({ key: 'stream-1' }))
            )

            expect(result).toEqual({
                value: { kind: 'value', value: 'served by runtime-3' },
            })
            expect(first.call).toHaveBeenCalledTimes(1)
            expect(owner.call).toHaveBeenCalledTimes(1)
        })

        it('keeps a stream a stream and counts it as open until it ends', async () => {
            const mesh = meshFixture({
                replicas: { 'runtime-1': answering(streamOf(1, 2)) },
            })
            await mesh.seed(runtime('runtime-1', 'A'))

            const result = await mesh.run(new MeshRelay.live().relay(request()))
            expect(result.kind).toBe('stream')

            const events = await collect(relayEvents(result))
            expect(events).toEqual([
                { kind: 'stream' },
                { kind: 'item', value: 1 },
                { kind: 'item', value: 2 },
            ])
        })

        it("passes the target's own error through with its code and data", async () => {
            const failing: Link = {
                call: vi.fn().mockRejectedValue(
                    new ORPCError('NOT_FOUND', {
                        message: 'no such stream',
                    })
                ),
            }
            const mesh = meshFixture({ replicas: { 'runtime-1': failing } })
            await mesh.seed(runtime('runtime-1', 'A'))

            const result = await mesh.settle(
                new MeshRelay.live().relay(request())
            )

            expect(result).toMatchObject({
                error: { code: 'NOT_FOUND', message: 'no such stream' },
            })
        })

        it('answers a transport failure as BAD_GATEWAY', async () => {
            const mesh = meshFixture({})
            await mesh.seed(runtime('runtime-1', 'A'))

            const result = await mesh.settle(
                new MeshRelay.live().relay(request())
            )

            expect(result).toMatchObject({ error: { code: 'BAD_GATEWAY' } })
        })

        it('fails with the service when no replica is known', async () => {
            const mesh = meshFixture()

            const result = await mesh.settle(
                new MeshRelay.live().relay(request({ service: 'ghost' }))
            )

            expect(result).toMatchObject({
                error: { _tag: 'MeshNoReplica', service: 'ghost' },
            })
        })
    })

    describe("the caller's credentials", () => {
        it('hands the target the headers the caller sent, which the agent neither reads nor keeps', async () => {
            const local = answering('ok')
            const mesh = meshFixture({
                nodeId: 'A',
                replicas: { 'runtime-1': local },
            })
            await mesh.seed(runtime('runtime-1', 'A'))

            await mesh.settle(
                new MeshRelay.live().relay(
                    request({
                        headers: {
                            cookie: 'session=alice',
                            authorization: 'Bearer t',
                        },
                    })
                )
            )

            expect(local.call).toHaveBeenCalledWith(
                ['logs', 'list'],
                { id: 1 },
                {
                    context: {
                        headers: {
                            cookie: 'session=alice',
                            authorization: 'Bearer t',
                        },
                    },
                }
            )
        })

        it('forwards them with the call when it is pinned to another node', async () => {
            const remoteAgent = answering(
                streamOf<MeshRelayEvent>({ kind: 'value', value: 1 })
            )
            const mesh = meshFixture({ nodeId: 'A', nodes: { B: remoteAgent } })

            await mesh.run(
                new MeshRelay.live().relay(
                    request({ node: 'B', headers: { cookie: 'session=alice' } })
                )
            )

            expect(remoteAgent.call).toHaveBeenCalledWith(
                ['relay', 'call'],
                expect.objectContaining({
                    headers: { cookie: 'session=alice' },
                }),
                { context: { headers: { cookie: 'session=alice' } } }
            )
        })
    })

    describe('node pinning', () => {
        it("forwards a call pinned to another node to that node's agent, and passes its events through", async () => {
            const remoteAgent = answering(
                streamOf<MeshRelayEvent>({
                    kind: 'value',
                    value: 'from node B',
                })
            )
            const mesh = meshFixture({ nodeId: 'A', nodes: { B: remoteAgent } })

            const outcome = await mesh.run(
                new MeshRelay.live().relay(request({ node: 'B' }))
            )

            expect(remoteAgent.call).toHaveBeenCalledWith(
                ['relay', 'call'],
                expect.objectContaining({ node: 'B', service: 'runtime' }),
                { context: { headers: {} } }
            )
            expect(await collect(relayEvents(outcome))).toEqual([
                { kind: 'value', value: 'from node B' },
            ])
        })

        it('fails with MeshNoRoute when the agent knows neither a link nor a next hop to the node', async () => {
            const mesh = meshFixture({ nodeId: 'A' })

            const result = await mesh.settle(
                new MeshRelay.live().relay(request({ node: 'Z' }))
            )

            expect(result).toMatchObject({
                error: { _tag: 'MeshNoRoute', nodeId: 'Z' },
            })
        })

        it('serves a call pinned to this node from this node only', async () => {
            const mesh = meshFixture({
                nodeId: 'A',
                replicas: { 'runtime-2': answering('remote') },
            })
            await mesh.seed(runtime('runtime-2', 'B'))

            const result = await mesh.settle(
                new MeshRelay.live().relay(request({ node: 'A' }))
            )

            expect(result).toMatchObject({ error: { _tag: 'MeshNoReplica' } })
        })
    })

    describe('direct leases', () => {
        const grantOf = (settled: { error?: unknown }) =>
            readDirectGrant(settled.error)

        it.each([
            ['a heavy procedure', { heavy: true }, {}],
            ['a caller that asks for a direct link', { direct: true }, {}],
            ['an overloaded agent', {}, { eventLoopLagMs: 500 }],
        ])(
            'answers %s with a grant instead of relaying',
            async (_name, flags, load) => {
                const replica = answering('never called')
                const mesh = meshFixture({
                    nodeId: 'A',
                    now: 1_000,
                    load,
                    replicas: { 'runtime-1': replica },
                })
                await mesh.seed(
                    runtime('runtime-1', 'A', { address: 'ws://10.0.0.1:3105' })
                )

                const settled = await mesh.settle(
                    new MeshRelay.live().relay(
                        request({ key: 'stream-1', ...flags })
                    )
                )
                const grant = grantOf(settled as { error?: unknown })

                expect(grant).toMatchObject({
                    replicaId: 'runtime-1',
                    address: 'ws://10.0.0.1:3105',
                    expiresAt: 31_000,
                })
                expect(replica.call).not.toHaveBeenCalled()
                expect(
                    verifyLease(
                        grant?.token ?? '',
                        LEASE_SECRET,
                        'runtime-1',
                        2_000
                    )
                ).toMatchObject({ ok: true })
            }
        )

        it('grants the replica that holds the key, even when another one is local', async () => {
            const mesh = meshFixture({ nodeId: 'A' })
            await mesh.seed(
                runtime('runtime-1', 'A'),
                runtime('runtime-3', 'C', { keys: ['stream-1'] })
            )

            const settled = await mesh.settle(
                new MeshRelay.live().relay(
                    request({ key: 'stream-1', heavy: true })
                )
            )

            expect(
                readDirectGrant((settled as { error?: unknown }).error)
                    ?.replicaId
            ).toBe('runtime-3')
        })

        it('grants a pair that is calling too fast', async () => {
            const mesh = meshFixture({
                replicas: { 'runtime-1': answering('ok') },
            })
            await mesh.seed(runtime('runtime-1', 'A'))

            for (let call = 0; call < 200; call += 1) {
                await mesh.settle(new MeshRelay.live().relay(request()))
            }
            const settled = await mesh.settle(
                new MeshRelay.live().relay(request())
            )

            expect(
                readDirectGrant((settled as { error?: unknown }).error)
            ).toMatchObject({ replicaId: 'runtime-1' })
        })

        it('fails with the service when the grant has no replica to name', async () => {
            const mesh = meshFixture()

            const settled = await mesh.settle(
                new MeshRelay.live().relay(request({ heavy: true }))
            )

            expect(settled).toMatchObject({ error: { _tag: 'MeshNoReplica' } })
        })

        it("builds the same error a caller's grant follower reads", () => {
            expect(
                readDirectGrant(
                    grantDirect({
                        replicaId: 'r',
                        address: 'a',
                        token: 't',
                        expiresAt: 1,
                    })
                )
            ).toBeDefined()
        })
    })

    describe('multi-hop relay', () => {
        const failing = (): Link => ({
            call: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
        })
        const answeringWith = (value: string): Link =>
            answering(streamOf<MeshRelayEvent>({ kind: 'value', value }))
        const taughtBy = (
            mesh: ReturnType<typeof meshFixture>,
            target: string,
            teacher: string
        ) =>
            Effect.runPromise(
                mesh.nodeAgents.know(
                    {
                        nodeId: target,
                        address: `ws://${target}`,
                        overlay: null,
                        labels: {},
                    },
                    teacher
                )
            )

        it('does not forward when the direct link works', async () => {
            const target = answeringWith('from C')
            const hop = answeringWith('never')
            const mesh = meshFixture({
                nodeId: 'A',
                nodes: { C: target, B: hop },
            })

            const outcome = await mesh.run(
                new MeshRelay.live().relay(request({ node: 'C' }))
            )

            expect(await collect(relayEvents(outcome))).toEqual([
                { kind: 'value', value: 'from C' },
            ])
            expect(hop.call).not.toHaveBeenCalled()
            expect(target.call).toHaveBeenCalledWith(
                ['relay', 'call'],
                expect.not.objectContaining({ via: expect.anything() }),
                { context: { headers: {} } }
            )
            expect(await Effect.runPromise(mesh.metrics.snapshot())).toEqual({
                forwarded: 0,
                noRoute: 0,
                unreachable: 0,
            })
        })

        it('forwards through a peer when the direct link fails at the transport, carrying visited, one hop less of ttl, and the headers', async () => {
            const target = failing()
            const hop = answeringWith('from C through B')
            const mesh = meshFixture({
                nodeId: 'A',
                nodes: { C: target, B: hop },
                relay: { maxHops: 2 },
            })

            const outcome = await mesh.run(
                new MeshRelay.live().relay(
                    request({ node: 'C', headers: { cookie: 'session=alice' } })
                )
            )

            expect(hop.call).toHaveBeenCalledWith(
                ['relay', 'call'],
                expect.objectContaining({
                    node: 'C',
                    via: { visited: ['A'], ttl: 1 },
                    headers: { cookie: 'session=alice' },
                }),
                { context: { headers: { cookie: 'session=alice' } } }
            )
            expect(await collect(relayEvents(outcome))).toEqual([
                { kind: 'value', value: 'from C through B' },
            ])
            expect(await Effect.runPromise(mesh.metrics.snapshot())).toEqual({
                forwarded: 1,
                noRoute: 0,
                unreachable: 1,
            })
        })

        it('tries first the agent that taught it the target', async () => {
            const b = answeringWith('from B')
            const d = answeringWith('from D')
            const mesh = meshFixture({
                nodeId: 'A',
                nodes: { C: failing(), B: b, D: d },
            })
            await taughtBy(mesh, 'C', 'D')

            const outcome = await mesh.run(
                new MeshRelay.live().relay(request({ node: 'C' }))
            )

            expect(d.call).toHaveBeenCalledTimes(1)
            expect(b.call).not.toHaveBeenCalled()
            expect(await collect(relayEvents(outcome))).toEqual([
                { kind: 'value', value: 'from D' },
            ])
        })

        it('falls through to the next candidate when the first one is dead', async () => {
            const mesh = meshFixture({
                nodeId: 'A',
                nodes: {
                    C: failing(),
                    B: failing(),
                    D: answeringWith('from D'),
                },
            })
            await taughtBy(mesh, 'C', 'B')

            const outcome = await mesh.run(
                new MeshRelay.live().relay(request({ node: 'C' }))
            )

            expect(await collect(relayEvents(outcome))).toEqual([
                { kind: 'value', value: 'from D' },
            ])
            expect(
                await Effect.runPromise(mesh.metrics.snapshot())
            ).toMatchObject({ forwarded: 1 })
        })

        it('fails with MeshNoRoute when no candidate answers', async () => {
            const mesh = meshFixture({ nodeId: 'A', nodes: { C: failing() } })

            const result = await mesh.settle(
                new MeshRelay.live().relay(request({ node: 'C' }))
            )

            expect(result).toMatchObject({
                error: { _tag: 'MeshNoRoute', nodeId: 'C' },
            })
            expect(
                await Effect.runPromise(mesh.metrics.snapshot())
            ).toMatchObject({ noRoute: 1 })
        })

        it('treats a peer that never answers as a transport failure, not as an answer', async () => {
            const hung: Link = {
                call: vi.fn(() => new Promise<never>(() => undefined)),
            }
            const mesh = meshFixture({
                nodeId: 'A',
                nodes: { C: hung },
                relay: { callTimeoutMs: 10 },
            })

            const result = await mesh.settle(
                new MeshRelay.live().relay(request({ node: 'C' }))
            )

            expect(result).toMatchObject({
                error: { _tag: 'MeshNoRoute', nodeId: 'C' },
            })
            expect(
                await Effect.runPromise(mesh.metrics.snapshot())
            ).toMatchObject({ unreachable: 1, noRoute: 1 })
        })

        it('refuses a forwarded call that arrives with no hops left, without calling anyone', async () => {
            const target = answeringWith('never')
            const hop = answeringWith('never')
            const mesh = meshFixture({
                nodeId: 'A',
                nodes: { C: target, B: hop },
            })

            const result = await mesh.settle(
                new MeshRelay.live().relay(
                    request({ node: 'C', via: { visited: ['B'], ttl: 0 } })
                )
            )

            expect(result).toMatchObject({
                error: { _tag: 'MeshNoRoute', nodeId: 'C' },
            })
            expect(target.call).not.toHaveBeenCalled()
            expect(hop.call).not.toHaveBeenCalled()
        })

        it('refuses a call that loops back to the target or to itself', async () => {
            const target = answeringWith('never')
            const mesh = meshFixture({ nodeId: 'A', nodes: { C: target } })

            const throughTarget = await mesh.settle(
                new MeshRelay.live().relay(
                    request({ node: 'C', via: { visited: ['C'], ttl: 2 } })
                )
            )
            const throughSelf = await mesh.settle(
                new MeshRelay.live().relay(
                    request({ node: 'C', via: { visited: ['A'], ttl: 2 } })
                )
            )

            expect(throughTarget).toMatchObject({
                error: { _tag: 'MeshRelayLoop', nodeId: 'C' },
            })
            expect(throughSelf).toMatchObject({
                error: { _tag: 'MeshRelayLoop', nodeId: 'A' },
            })
            expect(target.call).not.toHaveBeenCalled()
        })

        it("returns the target's own error instead of forwarding it", async () => {
            const target: Link = {
                call: vi.fn().mockRejectedValue(
                    new ORPCError('NOT_FOUND', {
                        message: 'no such stream',
                    })
                ),
            }
            const hop = answeringWith('never')
            const mesh = meshFixture({
                nodeId: 'A',
                nodes: { C: target, B: hop },
            })

            const result = await mesh.settle(
                new MeshRelay.live().relay(request({ node: 'C' }))
            )

            expect(result).toMatchObject({
                error: { code: 'NOT_FOUND', message: 'no such stream' },
            })
            expect(hop.call).not.toHaveBeenCalled()
            expect(await Effect.runPromise(mesh.metrics.snapshot())).toEqual({
                forwarded: 0,
                noRoute: 0,
                unreachable: 0,
            })
        })

        it('brokers a forwarded call instead of granting a lease, even when it asks for one', async () => {
            const local = answering('brokered')
            const mesh = meshFixture({
                nodeId: 'A',
                replicas: { 'runtime-1': local },
            })
            await mesh.seed(
                runtime('runtime-1', 'A', { address: 'ws://10.0.0.1:3105' })
            )

            const result = await mesh.settle(
                new MeshRelay.live().relay(
                    request({
                        node: 'A',
                        key: 'stream-1',
                        heavy: true,
                        via: { visited: ['B'], ttl: 1 },
                    })
                )
            )

            expect(result).toEqual({
                value: { kind: 'value', value: 'brokered' },
            })
            expect(local.call).toHaveBeenCalledTimes(1)
            expect(
                readDirectGrant((result as { error?: unknown }).error)
            ).toBeUndefined()
        })

        it('skips the direct attempt while the target is marked unreachable', async () => {
            const target = failing()
            const hop = answeringWith('from B')
            const mesh = meshFixture({
                nodeId: 'A',
                nodes: { C: target, B: hop },
            })

            await mesh.run(new MeshRelay.live().relay(request({ node: 'C' })))
            await mesh.run(new MeshRelay.live().relay(request({ node: 'C' })))

            expect(target.call).toHaveBeenCalledTimes(1)
            expect(hop.call).toHaveBeenCalledTimes(2)
            expect(await Effect.runPromise(mesh.metrics.snapshot())).toEqual({
                forwarded: 2,
                noRoute: 0,
                unreachable: 1,
            })
        })
    })
})
