import { Effect, Fiber, Stream } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { makeClusterEvents, type ClusterEventsDeps } from './cluster-events'

const inventoryRow = (nodeId: string, state: 'active' | 'down') => ({
    nodeId,
    hostname: `${nodeId}.local`,
    swarmRole: 'manager',
    platformRole: 'both',
    isLeader: false,
    isIngress: false,
    state,
    lastSeenAt: '2026-11-06T10:00:00.000Z',
})

const snapshot = (master: { nodeId: string } | null) => ({
    clusterId: 'c',
    nodeCount: 1,
    master: master === null ? null : { ...master, term: 3, electedAt: 'e', heartbeatAt: 'h', reason: 'raft_leader' },
})

type Options = {
    active?: boolean
    events?: readonly { Type?: string; Action?: string }[]
    snapshot?: () => Effect.Effect<unknown, unknown>
    rows?: ReturnType<typeof inventoryRow>[]
}

/** The hub over fakes, and the counters a case asserts on. Each stream observed is the underlying subject itself (no pool). */
function hubWith(options: Options = {}) {
    const calls = { snapshot: 0, services: 0, tasks: 0, inventory: 0 }
    const deps = {
        docker: {
            swarmCluster: { isActive: () => Effect.succeed(options.active ?? true) },
            events: { stream: () => Stream.fromIterable(options.events ?? []) },
        },
        cluster: {
            getLocalClusterSnapshot:
                options.snapshot ??
                (() => {
                    calls.snapshot++
                    return Effect.succeed(snapshot({ nodeId: 'n1' }))
                }),
        },
        fleet: {
            listServices: () => {
                calls.services++
                return Effect.succeed([{ id: 's1' }])
            },
            listTasks: () => {
                calls.tasks++
                return Effect.succeed([
                    { id: 't1', serviceId: 's1', nodeId: 'n1' },
                    { id: 't2', serviceId: 's2', nodeId: 'n1' },
                    { id: 't3', serviceId: 's1', nodeId: 'n2' },
                ])
            },
        },
        inventory: {
            list: () => {
                calls.inventory++
                return Effect.succeed(options.rows ?? [inventoryRow('n1', 'active'), inventoryRow('n2', 'down')])
            },
        },
        pool: { observePooledStream: (_key: string, factory: () => unknown) => factory() },
    } as unknown as ClusterEventsDeps
    return { hub: makeClusterEvents(deps), calls }
}

const latest = <T>(source: { subscribe: (next: (value: T) => void) => { unsubscribe: () => void } }): T | undefined => {
    let value: T | undefined
    source.subscribe((next) => {
        value = next
    }).unsubscribe()
    return value
}

describe('ClusterEvents', () => {
    it('loads the whole state once at start, so a subscriber never waits for the first event', async () => {
        const { hub, calls } = hubWith()

        await Effect.runPromise(hub.onStart?.() ?? Effect.void)

        expect(calls).toMatchObject({ snapshot: 1, services: 1, tasks: 1 })
        expect(latest(hub.observeSnapshot())).toMatchObject({ clusterId: 'c' })
        expect(latest(hub.observeMaster())).toMatchObject({ nodeId: 'n1', term: 3, state: 'healthy' })
        expect(latest(hub.observeServices())).toEqual([{ id: 's1' }])
    })

    it('on a node that is not in a swarm, refreshes the inventory and nothing else', async () => {
        const { hub, calls } = hubWith({ active: false })

        await Effect.runPromise(hub.onStart?.() ?? Effect.void)

        expect(calls).toMatchObject({ snapshot: 0, services: 0, tasks: 0, inventory: 1 })
        expect(latest(hub.observeNodes(true))?.map((row) => row.nodeId)).toEqual(['n1', 'n2'])
    })

    it('offers every node, or only the active ones', async () => {
        const { hub } = hubWith()
        await Effect.runPromise(hub.onStart?.() ?? Effect.void)

        expect(latest(hub.observeNodes(true))?.map((row) => row.nodeId)).toEqual(['n1', 'n2'])
        expect(latest(hub.observeNodes(false))?.map((row) => row.nodeId)).toEqual(['n1'])
    })

    it('narrows tasks to a service and/or a node', async () => {
        const { hub } = hubWith()
        await Effect.runPromise(hub.onStart?.() ?? Effect.void)

        expect(latest(hub.observeTasks())?.map((task) => task.id)).toEqual(['t1', 't2', 't3'])
        expect(latest(hub.observeTasks('s1'))?.map((task) => task.id)).toEqual(['t1', 't3'])
        expect(latest(hub.observeTasks('s1', 'n2'))?.map((task) => task.id)).toEqual(['t3'])
    })

    it('keeps the previous state when a refresh half-fails, and still updates what it could read', async () => {
        let failing = false
        const { hub } = hubWith({
            snapshot: () =>
                failing ? Effect.fail(new Error('engine busy')) : Effect.succeed(snapshot({ nodeId: 'n1' })),
        })
        await Effect.runPromise(hub.onStart?.() ?? Effect.void)

        failing = true
        await Effect.runPromise(hub.onStart?.() ?? Effect.void)

        // The snapshot read failed, so the old snapshot stays; services and tasks were still read.
        expect(latest(hub.observeSnapshot())).toMatchObject({ clusterId: 'c' })
        expect(latest(hub.observeServices())).toEqual([{ id: 's1' }])
    })

    it('refreshes once per burst of swarm events, and ignores events that are not about the swarm', async () => {
        vi.useFakeTimers()
        try {
            const { hub, calls } = hubWith({
                events: [
                    { Type: 'service', Action: 'update' },
                    { Type: 'task', Action: 'start' },
                    { Type: 'node', Action: 'update' },
                    { Type: 'container', Action: 'die' },
                ],
            })

            const fiber = Effect.runFork(hub.run?.() ?? Effect.void)
            await vi.advanceTimersByTimeAsync(700)

            // Three swarm events inside one window: one refresh. The container event counts for nothing.
            expect(calls.snapshot).toBe(1)
            await Effect.runPromise(Fiber.interrupt(fiber))
        } finally {
            vi.useRealTimers()
        }
    })

    it('looks at the engine again after its event stream ends', async () => {
        vi.useFakeTimers()
        try {
            let subscriptions = 0
            // A stream that counts how often it is subscribed to.
            const deps = {
                docker: {
                    swarmCluster: { isActive: () => Effect.succeed(false) },
                    events: {
                        stream: () => {
                            subscriptions++
                            return Stream.empty
                        },
                    },
                },
                cluster: {},
                fleet: {},
                inventory: { list: () => Effect.succeed([]) },
                pool: { observePooledStream: (_k: string, f: () => unknown) => f() },
            } as unknown as ClusterEventsDeps
            const reconnecting = makeClusterEvents(deps)

            const fiber = Effect.runFork(reconnecting.run?.() ?? Effect.void)
            await vi.advanceTimersByTimeAsync(11_000)
            await Effect.runPromise(Fiber.interrupt(fiber))

            expect(subscriptions).toBeGreaterThanOrEqual(2)
        } finally {
            vi.useRealTimers()
        }
    })
})
