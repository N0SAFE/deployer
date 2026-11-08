import { Context, Effect } from 'effect'

import type { SupervisorEventBusShape } from '../events/event-bus'
import type { AnySupervisor } from '../supervisor/supervisor'

/** How long a lookup waits for a supervisor to register itself before giving up. */
export const DEFAULT_REGISTRATION_WAIT_MS = 10_000
const REGISTRATION_POLL_MS = 50

export type SupervisorRegistryShape = {
    /**
     * Adds a supervisor, announcing it on the bus. Registering the same one again does nothing;
     * another supervisor with the same id is an error.
     */
    readonly register: (supervisor: AnySupervisor) => Effect.Effect<void, Error>
    readonly list: () => AnySupervisor[]
    readonly has: (supervisorId: string) => boolean
    readonly get: (supervisorId: string) => AnySupervisor | null
    /** The first registered supervisor `predicate` accepts. */
    readonly find: (
        predicate: (supervisor: AnySupervisor) => boolean
    ) => AnySupervisor | null
    /**
     * Waits, up to `timeoutMs`, for a supervisor `predicate` accepts to register: supervisors
     * register when each is ready (the global-db one waits for its database URL), which can be late.
     * Null when none did.
     */
    readonly awaitMatch: (
        predicate: (supervisor: AnySupervisor) => boolean,
        timeoutMs?: number
    ) => Effect.Effect<AnySupervisor | null>
}

/**
 * The one implementation of `SupervisorRegistryShape`.
 *
 * The bus is a constructor argument — it is optional, so it cannot be a tag — and the map is
 * per-instance state.
 */
export class SupervisorRegistryImpl implements SupervisorRegistryShape {
    private readonly supervisors = new Map<string, AnySupervisor>()

    constructor(private readonly bus?: SupervisorEventBusShape) {}

    register(supervisor: AnySupervisor): Effect.Effect<void, Error> {
        return Effect.gen({ self: this }, function* () {
            const existing = this.supervisors.get(supervisor.id)
            if (existing !== undefined) {
                if (
                    existing.source === supervisor.source &&
                    existing.label === supervisor.label
                )
                    return
                return yield* Effect.fail(
                    new Error(
                        `Duplicate supervisorId "${supervisor.id}" registered by both ${existing.label} and ${supervisor.label}`
                    )
                )
            }
            this.supervisors.set(supervisor.id, supervisor)
            yield* Effect.logInfo(
                `Registered supervisor "${supervisor.id}" (${supervisor.label})`
            )
            if (this.bus !== undefined) yield* supervisor.announce
        })
    }

    list(): AnySupervisor[] {
        return [...this.supervisors.values()]
    }

    has(supervisorId: string): boolean {
        return this.supervisors.has(supervisorId)
    }

    get(supervisorId: string): AnySupervisor | null {
        return this.supervisors.get(supervisorId) ?? null
    }

    find(predicate: (supervisor: AnySupervisor) => boolean): AnySupervisor | null {
        for (const supervisor of this.supervisors.values())
            if (predicate(supervisor)) return supervisor
        return null
    }

    awaitMatch(
        predicate: (supervisor: AnySupervisor) => boolean,
        timeoutMs = DEFAULT_REGISTRATION_WAIT_MS
    ): Effect.Effect<AnySupervisor | null> {
        return Effect.gen({ self: this }, function* () {
            const deadline = Date.now() + timeoutMs
            for (;;) {
                const found = this.find(predicate)
                if (found !== null) return found
                if (Date.now() >= deadline) return null
                yield* Effect.sleep(REGISTRATION_POLL_MS)
            }
        })
    }
}

/** The supervisors this process has registered, as an Effect service. */
export class SupervisorRegistry extends Context.Service<
    SupervisorRegistry,
    SupervisorRegistryShape
>()('supervision/SupervisorRegistry') {
    /** The implementation: it owns the map and takes the optional bus. */
    static readonly live = SupervisorRegistryImpl
}
