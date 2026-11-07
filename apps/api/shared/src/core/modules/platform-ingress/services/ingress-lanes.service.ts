/**
 * IngressLanesService — the stack's lanes, stored in the MESH.
 *
 * The lanes are a cluster-wide fact, so they live in the replicated cluster settings (`ingress.lanes`) rather than in one
 * node's SQLite: the API is a replicated swarm service that can be rescheduled to any node, and a setting that lives on the
 * node it happened to start on is lost the moment it moves.
 *
 * When there is no cluster store yet (a node mid-onboarding, before setup started its agent) the lanes read as the install
 * default — local only — which is the one answer that can never expose the machine. Writes fail loudly instead: an operator's
 * choice must never be silently dropped.
 *
 * This service stores lanes; it does not judge them. Checking a public lane against its edge provider is the registry's job
 * (`EdgeProviderRegistry.normalize`), done by whoever accepts the operator's input.
 */

import { Context, Effect } from 'effect'

import {
    defaultIngressLanes,
    ingressLanesSchema,
    type IngressLanes,
} from '@deployer/contracts-entities/entities/ingress/index'

import { ClusterSettings } from '../../mesh-node/cluster-settings'
import { IngressLanesUnavailable } from '../platform-ingress.errors'

export const INGRESS_LANES_SETTING = 'ingress.lanes'

export type IngressLanesServiceShape = {
    /** The lanes in effect: the replicated setting, else local-only. */
    readonly getLanes: () => Effect.Effect<
        IngressLanes,
        IngressLanesUnavailable,
        ClusterSettings
    >
    readonly setLanes: (
        next: IngressLanes
    ) => Effect.Effect<IngressLanes, IngressLanesUnavailable, ClusterSettings>
}

/** Any failure of the cluster store, named by the operation that raised it. */
const failed = (operation: string) => (cause: unknown) =>
    new IngressLanesUnavailable({ operation, cause })

/**
 * Tag and implementation together: the tag is the contract, `live` the one implementation.
 *
 * The replicated store is yielded per call. `entryPort` is the value the install-default lanes are seeded with — a plain
 * number the module resolves from the existing environment accessor (`DEPLOYER_TRAEFIK_HTTP_PORT`), not a new read.
 */
export class IngressLanesService extends Context.Service<
    IngressLanesService,
    IngressLanesServiceShape
>()('shared/IngressLanesService') {
    static readonly live = class IngressLanesServiceImpl
        implements IngressLanesServiceShape
    {
        constructor(private readonly entryPort: number) {}

        getLanes(): ReturnType<IngressLanesServiceShape['getLanes']> {
            return Effect.gen({ self: this }, function* () {
                const settings = yield* ClusterSettings
                return yield* Effect.suspend(() =>
                    settings.read(
                        INGRESS_LANES_SETTING,
                        ingressLanesSchema,
                        defaultIngressLanes(this.entryPort)
                    )
                ).pipe(Effect.mapError(failed('read')))
            })
        }

        setLanes(
            next: IngressLanes
        ): ReturnType<IngressLanesServiceShape['setLanes']> {
            return Effect.gen(function* () {
                const settings = yield* ClusterSettings
                yield* settings
                    .write(INGRESS_LANES_SETTING, next)
                    .pipe(Effect.mapError(failed('written')))
                yield* Effect.logInfo(
                    `Ingress lanes set — local${next.private.enabled ? ` + private (${next.private.domain})` : ''}${
                        next.public === null
                            ? ''
                            : ` + public via ${next.public.provider} (${next.public.domain})`
                    }`
                )
                return next
            })
        }
    }
}
