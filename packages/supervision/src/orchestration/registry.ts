import { Effect } from 'effect'

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

export function makeSupervisorRegistry(
    bus?: SupervisorEventBusShape
): SupervisorRegistryShape {
    const supervisors = new Map<string, AnySupervisor>()

    const find: SupervisorRegistryShape['find'] = (predicate) => {
        for (const supervisor of supervisors.values())
            if (predicate(supervisor)) return supervisor
        return null
    }

    return {
        register: (supervisor) =>
            Effect.gen(function* () {
                const existing = supervisors.get(supervisor.id)
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
                supervisors.set(supervisor.id, supervisor)
                yield* Effect.logInfo(
                    `Registered supervisor "${supervisor.id}" (${supervisor.label})`
                )
                if (bus !== undefined) yield* supervisor.announce
            }),
        list: () => [...supervisors.values()],
        has: (supervisorId) => supervisors.has(supervisorId),
        get: (supervisorId) => supervisors.get(supervisorId) ?? null,
        find,
        awaitMatch: (predicate, timeoutMs = DEFAULT_REGISTRATION_WAIT_MS) =>
            Effect.gen(function* () {
                const deadline = Date.now() + timeoutMs
                for (;;) {
                    const found = find(predicate)
                    if (found !== null) return found
                    if (Date.now() >= deadline) return null
                    yield* Effect.sleep(REGISTRATION_POLL_MS)
                }
            }),
    }
}
