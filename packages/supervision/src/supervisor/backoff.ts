import { Effect } from 'effect'

export type BackoffOptions = {
    /** Attempts before giving up. Default 5. */
    readonly maxAttempts?: number
    /** Delay before the second attempt; doubles each time. Default 1000. */
    readonly baseDelayMs?: number
    /** Ceiling for the delay. Default 60000. */
    readonly maxDelayMs?: number
}

const DEFAULTS = { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 60_000 }

/**
 * Runs `attempt` until it succeeds, waiting longer between tries. Fails with the last error once the
 * attempts run out, and straight away with an error `isFatal` calls deterministic: retrying a
 * conflict that cannot change would only hide the cause behind several copies of it.
 */
export function withBackoff<A>(
    label: string,
    attempt: Effect.Effect<A, unknown>,
    options: BackoffOptions & {
        readonly isFatal?: (error: unknown) => boolean
        /** Replaces the real wait; for callers that already own a sleep. */
        readonly sleep?: (ms: number) => Effect.Effect<void>
    } = {}
): Effect.Effect<A, unknown> {
    const { maxAttempts, baseDelayMs, maxDelayMs } = { ...DEFAULTS, ...options }
    const sleep = options.sleep ?? ((ms: number) => Effect.sleep(ms))
    return Effect.gen(function* () {
        let lastError: unknown = null
        for (let n = 1; n <= maxAttempts; n++) {
            const outcome = yield* attempt.pipe(
                Effect.map((value) => ({ ok: true as const, value })),
                Effect.catch((error) =>
                    Effect.succeed({ ok: false as const, error })
                )
            )
            if (outcome.ok) return outcome.value
            lastError = outcome.error
            const message =
                outcome.error instanceof Error
                    ? outcome.error.message
                    : String(outcome.error)
            yield* Effect.logWarning(
                `${label} attempt ${String(n)}/${String(maxAttempts)} failed: ${message}`
            )
            if (options.isFatal?.(outcome.error) === true)
                return yield* Effect.fail(outcome.error)
            if (n < maxAttempts)
                yield* sleep(Math.min(baseDelayMs * 2 ** (n - 1), maxDelayMs))
        }
        return yield* Effect.fail(lastError)
    })
}
