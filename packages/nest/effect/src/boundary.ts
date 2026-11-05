import { Cause, Effect } from 'effect'

import { Actor } from '@deployer/effect-core'
import type { DomainError } from '@deployer/effect-core'
import {
    handle,
    provideRequest,
    type RequestContextInput,
} from '@deployer/effect-orpc'

/**
 * The request boundary every `.effect()` handler runs inside.
 *
 * It replaces what each controller used to wrap around every call (`serve(context)(effect)`): it provides `CurrentActor`,
 * `Correlation` and `HttpRequest`, maps domain errors by kind and hides defects behind the correlation id. Authorization is
 * NOT decided here — `requireAuth()` / `access(...)` refuse before the handler runs — so a caller with no session acts as
 * the `anonymous` user and the gate in front of the handler is the only thing that can refuse it.
 */
export type BoundaryOptions = {
    /** Prefixes the defect log line, e.g. `svc-identity`. */
    readonly service: string
    /** Let typed failures that are not domain errors reach the host's interceptors (services still on Promise collaborators). */
    readonly passThroughFailures?: boolean
    /** Every typed refusal, with the request it came from, for the audit trail (`SEC-068`). Fire-and-forget. */
    readonly onDomainFailure?: (
        context: RequestContextInput,
        error: DomainError,
        correlationId: string
    ) => void
}

let active: BoundaryOptions = { service: 'svc', passThroughFailures: true }

export function configureBoundary(options: BoundaryOptions): void {
    active = options
}

/** Runs one handler body inside the boundary of the request it serves. */
export function inBoundary<A, E, R>(
    context: RequestContextInput | undefined,
    effect: Effect.Effect<A, E, R>
) {
    const request = context ?? {}
    const options = active
    return effect.pipe(
        handle(
            (cause, correlationId) => {
                console.error(
                    `[${options.service}] defect ${correlationId}`,
                    Cause.pretty(cause)
                )
            },
            {
                passThroughFailures: options.passThroughFailures === true,
                ...(options.onDomainFailure === undefined
                    ? {}
                    : {
                          onDomainFailure: (error: DomainError, id: string) => {
                              options.onDomainFailure?.(request, error, id)
                          },
                      }),
            }
        ),
        provideRequest(request, () =>
            Effect.succeed(Actor.user('anonymous', 'anonymous'))
        )
    )
}
