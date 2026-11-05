/**
 * EdgeStateStore — where an edge provider keeps what it created (tunnel ids, credentials…), replicated to every member.
 *
 * One cluster setting per provider (`edge.<provider id>`), validated by the provider's own schema, so providers never
 * collide and never need a migration of someone else's shape.
 *
 * Credentials stored here (a connector token) replicate to every member: a connector may be scheduled on any node, and
 * members are admitted, WireGuard-encrypted peers — the same trust boundary as the cluster itself. They NEVER travel to a
 * client: providers report `EdgeStatus` facts, not their state.
 */

import { Context, Effect } from 'effect'

import { EdgeStateFailure } from './edge.errors'

import type { ClusterSettingsShape } from '../mesh-node/cluster-settings'
import type z from 'zod/v4'

export function edgeStateKey(providerId: string): string {
    return `edge.${providerId}`
}

export type EdgeStateStoreShape = {
    /** The provider's state, or null when it has none (never provisioned, torn down, malformed). */
    readonly read: <T extends z.ZodType>(
        providerId: string,
        schema: T
    ) => Effect.Effect<z.output<T> | null, EdgeStateFailure>
    /** A write that cannot be stored FAILS: an operator's choice is never silently dropped. */
    readonly write: <T extends z.ZodType>(
        providerId: string,
        schema: T,
        value: z.input<T>
    ) => Effect.Effect<void, EdgeStateFailure>
    /** Forget the provider's state. Written as `null` so the removal replicates like any write. */
    readonly clear: (
        providerId: string
    ) => Effect.Effect<void, EdgeStateFailure>
}

export function makeEdgeStateStore(
    settings: Pick<ClusterSettingsShape, 'read' | 'write'>
): EdgeStateStoreShape {
    const failed = (operation: string) => (cause: unknown) =>
        new EdgeStateFailure({ operation, cause })

    return {
        read: (providerId, schema) =>
            settings
                .read(edgeStateKey(providerId), schema.nullable(), null)
                .pipe(Effect.mapError(failed('read'))),
        write: (providerId, schema, value) =>
            Effect.try({
                try: () => schema.parse(value),
                catch: failed('validated'),
            }).pipe(
                Effect.flatMap((parsed) =>
                    settings
                        .write(edgeStateKey(providerId), parsed)
                        .pipe(Effect.mapError(failed('written')))
                )
            ),
        clear: (providerId) =>
            settings
                .write(edgeStateKey(providerId), null)
                .pipe(Effect.mapError(failed('cleared'))),
    }
}

export class EdgeStateStore extends Context.Service<
    EdgeStateStore,
    EdgeStateStoreShape
>()('shared/EdgeStateStore') {}
