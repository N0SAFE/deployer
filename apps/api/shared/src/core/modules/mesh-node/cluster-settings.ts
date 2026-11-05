/**
 * ClusterSettings — the cluster-wide key/value store, as the API reads it.
 *
 * The settings live in the mesh roster: every agent holds all of them, any member may write one, and gossip converges them.
 * That makes them the right home for every fact that belongs to the CLUSTER rather than to the node the API happens to run
 * on (ingress lanes, the public edge's state, node doors): the API is a replicated swarm service and can be rescheduled
 * anywhere.
 *
 * The store is reached through this node's agent node door, served on a local socket, so a read never leaves the machine.
 * Every plane that keeps cluster state goes through here, so the parsing, the caller's default and the validation are
 * written once:
 *
 *   - no agent, or an agent in no cluster yet, reads as the caller's default; and writes FAIL: an operator's choice is
 *     never silently dropped.
 */

import { Context, Effect } from 'effect'

import { domainError } from '@deployer/effect-core'
import type { NodeDoorClient } from '@deployer/mesh-client'

import type z from 'zod/v4'

/** The cluster store could not be reached (the door failed) or refused a write (no agent on this node); the cause stays server-side. */
export class ClusterSettingsUnavailable extends domainError(
    'ClusterSettingsUnavailable',
    'dependency_missing'
)<{
    readonly operation: string
}>() {
    override publicMessage() {
        return `The cluster settings are unavailable (${this.operation}).`
    }
}

export type ClusterSettingsShape = {
    /** Whether the cluster store is reachable at all (an agent in a cluster). */
    readonly available: () => Effect.Effect<boolean, ClusterSettingsUnavailable>
    /** Every setting, decoded. A value that is not JSON is skipped and logged. */
    readonly readAll: () => Effect.Effect<
        Record<string, unknown>,
        ClusterSettingsUnavailable
    >
    /**
     * One setting, validated when a schema is given. `fallback` when it is unset, when there is no cluster yet, or when the
     * stored value does not match `schema` (logged: a malformed value must not take a plane down).
     */
    readonly read: <T>(
        key: string,
        schema: z.ZodType<T> | null,
        fallback: T
    ) => Effect.Effect<T, ClusterSettingsUnavailable>
    /** Write one setting. Fails when there is no agent to write to, so a choice is never dropped. */
    readonly write: (
        key: string,
        value: unknown
    ) => Effect.Effect<void, ClusterSettingsUnavailable>
}

/** The node door is still a Promise-based client of the mesh package, so every call is lifted. */
export function makeClusterSettings(
    door: NodeDoorClient
): ClusterSettingsShape {
    const lift = <A>(operation: string, run: () => Promise<A>) =>
        Effect.tryPromise({
            try: run,
            catch: (cause) =>
                new ClusterSettingsUnavailable({ operation, cause }),
        })

    const readAll: ClusterSettingsShape['readAll'] = () =>
        Effect.gen(function* () {
            const settings: Record<string, unknown> = {}
            for (const setting of (yield* lift('read', () =>
                door.settings()
            )) ?? []) {
                const decoded = yield* Effect.try({
                    try: () => JSON.parse(setting.value) as unknown,
                    catch: (cause) => cause,
                }).pipe(
                    Effect.map((value) => ({ ok: true as const, value })),
                    Effect.catch((cause) =>
                        Effect.logWarning(
                            `Ignoring malformed cluster setting ${setting.key}: ${cause instanceof Error ? cause.message : String(cause)}`
                        ).pipe(Effect.as({ ok: false as const }))
                    )
                )
                if (decoded.ok) settings[setting.key] = decoded.value
            }
            return settings
        })

    return {
        available: () =>
            lift('probe', () => door.settings()).pipe(
                Effect.map((settings) => settings !== null)
            ),
        readAll,

        read: <T>(key: string, schema: z.ZodType<T> | null, fallback: T) =>
            Effect.gen(function* () {
                const raw = (yield* readAll())[key]
                if (raw === undefined) return fallback
                if (schema === null) return raw as T
                const parsed = schema.safeParse(raw)
                if (parsed.success) return parsed.data
                yield* Effect.logError(
                    `Ignoring malformed cluster setting ${key}: ${parsed.error.message}`
                )
                return fallback
            }),

        write: (key, value) =>
            lift('written', () => door.writeSetting(key, value)).pipe(
                Effect.flatMap((written) =>
                    written === null
                        ? Effect.fail(
                              new ClusterSettingsUnavailable({
                                  operation: `no mesh agent on this node — cluster setting ${key} was not written`,
                              })
                          )
                        : Effect.void
                )
            ),
    }
}

export class ClusterSettings extends Context.Service<
    ClusterSettings,
    ClusterSettingsShape
>()('shared/ClusterSettings') {}
