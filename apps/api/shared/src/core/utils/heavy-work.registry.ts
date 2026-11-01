/**
 * Process-wide counter of work that competes for the same machine resources.
 *
 * ── WHY A REGISTRY AND NOT A CONFIG VALUE ───────────────────────────────────
 * Anything that decides "how much can I run right now" needs to know what ELSE
 * is already running: a scan that starts while a deployment is building an image
 * is the case that took the dev host into 25 GB of swap. The producers are in
 * different modules (docker scans, deployment builds, deployment queues), so they
 * report here instead of every consumer learning about the others.
 *
 * ── SCOPE ───────────────────────────────────────────────────────────────────
 * One process. That is the unit that shares the docker daemon and the CPU in this
 * architecture: every service runs in its own container, and the scanners run as
 * sibling containers of the one that starts them.
 */

export type HeavyWorkKind = 'scan' | 'build' | 'deploy'

const counters: Record<HeavyWorkKind, number> = {
    scan: 0,
    build: 0,
    deploy: 0,
}

/**
 * Mark work as in flight. Returns an idempotent release function — call it in a
 * `finally`, and never rely on the caller remembering to balance the pair.
 */
export function beginHeavyWork(kind: HeavyWorkKind): () => void {
    counters[kind] += 1

    let released = false
    return () => {
        if (released) {
            return
        }
        released = true
        counters[kind] = Math.max(0, counters[kind] - 1)
    }
}

export function heavyWorkSnapshot(): Readonly<Record<HeavyWorkKind, number>> {
    return { ...counters }
}

/** Test hook: the counters are module state and must not leak between tests. */
export function resetHeavyWorkForTests(): void {
    counters.scan = 0
    counters.build = 0
    counters.deploy = 0
}
