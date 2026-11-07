import { Effect, Fiber } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Over, RequirementsOf } from '@deployer/effect-core'
import type { EffectHostShape } from '@deployer/nest-effect'

import { startIngressDnsReconciler } from './ingress-dns-reconciler'
import {
    IngressEdgeService,
    type IngressEdgeServiceShape,
} from './ingress-edge.service'

/** What the ingress edge's methods leave open while they run — its collaborators and their needs. */
type IngressEdgePorts = RequirementsOf<IngressEdgeServiceShape>

/** A host that records the program instead of running it, so the loop can be started on demand. */
function fakeHost() {
    const forks: { label: string; effect: unknown }[] = []
    const stop = vi.fn(() => Promise.resolve())
    const host = {
        fork: vi.fn((label: string, effect: unknown) => {
            forks.push({ label, effect })
            return stop
        }),
    } as unknown as EffectHostShape
    return { host, forks, stop }
}

function fakeIngress() {
    const reconcileDns = vi.fn(() => Effect.void)
    const service = { reconcileDns } as unknown as Over<
        IngressEdgeServiceShape,
        IngressEdgePorts
    >
    return { reconcileDns, service }
}

/**
 * Run the forked loop until `done()` holds (or `ceilingMs` passes), then interrupt it as shutdown would.
 *
 * Waits for the CONDITION instead of sleeping a fixed slice and counting calls: a real-time window of a few tens of ms is
 * a race with whatever else the machine is doing (the first `Logger.warn` alone can eat it under a parallel suite), and a
 * test that passes alone and fails in the suite proves nothing. `ceilingMs` only bounds a loop that really is stuck.
 */
async function runUntil(
    effect: unknown,
    service: Over<IngressEdgeServiceShape, IngressEdgePorts>,
    done: () => boolean,
    ceilingMs = 5_000
): Promise<void> {
    const fiber = Effect.runFork(
        (effect as Effect.Effect<void, never, IngressEdgeService>).pipe(
            Effect.provideService(IngressEdgeService, service)
        )
    )
    const deadline = Date.now() + ceilingMs
    while (!done() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5))
    }
    await Effect.runPromise(Fiber.interrupt(fiber))
}

/** Run the forked loop for a short real slice, for the one assertion that is about something NOT happening. */
async function runFor(
    effect: unknown,
    service: Over<IngressEdgeServiceShape, IngressEdgePorts>,
    ms: number
): Promise<void> {
    await runUntil(effect, service, () => false, ms)
}

describe('startIngressDnsReconciler', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('forks one labelled program on the host and stops it when the application shuts down', async () => {
        const { host, forks, stop } = fakeHost()
        const handle = startIngressDnsReconciler(host, 1_000)

        expect(forks.map((fork) => fork.label)).toEqual([
            'fleet/ingress-dns-reconciler',
        ])

        await handle.onApplicationShutdown()
        expect(stop).toHaveBeenCalledTimes(1)
    })

    it('reconciles on every tick until the fiber is interrupted', async () => {
        const { host, forks } = fakeHost()
        const { reconcileDns, service } = fakeIngress()
        startIngressDnsReconciler(host, 5, 0)

        await runUntil(
            forks[0]?.effect,
            service,
            () => reconcileDns.mock.calls.length > 1
        )

        expect(reconcileDns.mock.calls.length).toBeGreaterThan(1)
    })

    it('survives a reconcile that fails, and tries again on the next tick', async () => {
        const { host, forks } = fakeHost()
        const { reconcileDns, service } = fakeIngress()
        reconcileDns.mockImplementation(
            () => Effect.fail(new Error('platform said no')) as never
        )
        startIngressDnsReconciler(host, 5, 0)

        await runUntil(
            forks[0]?.effect,
            service,
            () => reconcileDns.mock.calls.length > 1
        )

        // A loop that died on the first failure would have run exactly once.
        expect(reconcileDns.mock.calls.length).toBeGreaterThan(1)
    })

    it('does not run before the startup delay, so the context is populated when it does', async () => {
        const { host, forks } = fakeHost()
        const { reconcileDns, service } = fakeIngress()
        startIngressDnsReconciler(host, 5, 10_000)

        await runFor(forks[0]?.effect, service, 40)

        expect(reconcileDns).not.toHaveBeenCalled()
    })
})
