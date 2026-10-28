import { Observable, defer, from, interval, merge, of, timer } from 'rxjs'
import {
    catchError,
    distinctUntilChanged,
    map,
    switchMap,
} from 'rxjs/operators'

export interface LiveSnapshotOptions {
    /**
     * How often the server re-evaluates the snapshot.
     *
     * This is the value the CLIENT used to poll at. It stays on the server so one
     * stream serves every subscriber with one evaluation, and because a snapshot
     * endpoint has no domain event to hang the update off (a metrics rollup is
     * computed, not appended).
     */
    intervalMs: number
    /** Skip the immediate evaluation and wait one interval. Default: emit at once. */
    skipInitial?: boolean
    /** Structural equality for "did it change?"; default is JSON comparison. */
    equals?: (left: unknown, right: unknown) => boolean
}

/**
 * Turn "call this function" into "emit it whenever it changes".
 *
 * ── WHY: POLLING LIVES ON THE SERVER, NOT IN EVERY TAB ─────────────────────────
 * The dashboard used to poll these endpoints with `refetchInterval` — 10 s, 15 s,
 * 30 s, 60 s per open tab, whether or not anything had changed. A stream
 * re-evaluates ONCE for all subscribers, pushes ONLY when the JSON payload
 * differs, and stops the moment the last subscriber disconnects.
 *
 * ── ORDERING, AND WHY IT IS `switchMap` ────────────────────────────────────────
 * A slow evaluation must not stack up behind the next tick: `switchMap` cancels
 * the in-flight one, so a metrics query that takes longer than `intervalMs`
 * degrades to "as fast as it completes" instead of to an unbounded queue.
 *
 * ── FAILURES DO NOT KILL THE STREAM ────────────────────────────────────────────
 * A failed evaluation is dropped and retried on the next tick: the last good
 * snapshot stays on screen, which is what a dashboard should do when a single
 * query blips. The client's query stays pending until the first success, so a
 * persistent failure is visible as "no data", not as a stale lie.
 */
export function liveSnapshot<T>(
    evaluate: () => Promise<T>,
    options: LiveSnapshotOptions
): Observable<T> {
    const intervalMs = Math.max(250, Math.trunc(options.intervalMs))
    const equals =
        options.equals ??
        ((left: unknown, right: unknown) =>
            JSON.stringify(left) === JSON.stringify(right))

    const ticks: Observable<number> = options.skipInitial
        ? interval(intervalMs)
        : merge(of(-1), timer(intervalMs, intervalMs))

    return ticks.pipe(
        switchMap(() =>
            defer(() => from(evaluate())).pipe(catchError(() => []))
        ),
        distinctUntilChanged(equals),
        // Re-typed: `distinctUntilChanged` widens the inferred type to unknown.
        map((snapshot) => snapshot as T)
    )
}
