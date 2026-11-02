import { firstValueFrom, take, toArray } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'

import { liveSnapshot } from './live-snapshot.utils'

/**
 * `liveSnapshot` is the whole "poll on the server, push on change" contract the
 * `…/stream` analytics and cluster endpoints sit on. Three behaviours matter, and
 * each was a bug in the client-side polling it replaces:
 */
describe('liveSnapshot', () => {
    it('emits the first snapshot immediately, then only CHANGED ones', async () => {
        const snapshots = [1, 1, 2, 2, 3]
        let index = 0
        const evaluate = vi.fn(async () => snapshots[index++] ?? 3)

        const emitted = await firstValueFrom(
            liveSnapshot(evaluate, { intervalMs: 250 }).pipe(take(3), toArray())
        )

        // 1 → 2 → 3; the duplicate 1 and 2 are suppressed.
        expect(emitted).toEqual([1, 2, 3])
    })

    it('drops a failed evaluation and keeps the stream alive', async () => {
        const evaluate = vi
            .fn<() => Promise<number>>()
            .mockRejectedValueOnce(new Error('transient'))
            .mockResolvedValue(42)

        const value = await firstValueFrom(
            liveSnapshot(evaluate, { intervalMs: 250 }).pipe(take(1))
        )

        expect(value).toBe(42)
        expect(evaluate).toHaveBeenCalledTimes(2)
    })

    it('stops evaluating once the last subscriber unsubscribes', async () => {
        const evaluate = vi.fn(async () => ({ at: Date.now() }))

        const subscription = liveSnapshot(evaluate, {
            intervalMs: 250,
        }).subscribe(() => undefined)
        await new Promise((resolve) => setTimeout(resolve, 50))
        subscription.unsubscribe()

        const callsAtUnsubscribe = evaluate.mock.calls.length
        await new Promise((resolve) => setTimeout(resolve, 400))

        expect(evaluate).toHaveBeenCalledTimes(callsAtUnsubscribe)
    })
})
