export type TickLoopOptions = {
    readonly intervalMs: number
    /** One pass; never throws by contract. */
    readonly tick: () => Promise<unknown>
    readonly onError?: (error: unknown) => void
}

export type TickLoop = {
    readonly stop: () => void
}

/**
 * Runs one pass on an interval until stopped — the doors, the overlay, anything that converges the host.
 *
 * A failed pass must never end the loop: the next tick re-reads the state it converged from and retries, which is what
 * makes a node that booted before its setting or its peer recovered on its own.
 */
export function startTickLoop(options: TickLoopOptions): TickLoop {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
        try {
            await options.tick()
        } catch (error) {
            // A failed pass must not end the loop: the next tick re-reads the setting and retries.
            if (!stopped) {
                options.onError?.(error)
            }
        }
        if (!stopped) {
            timer = setTimeout(() => void tick(), options.intervalMs)
            timer.unref()
        }
    }

    void tick()

    return {
        stop() {
            stopped = true
            clearTimeout(timer)
        },
    }
}
