import { Effect } from 'effect'

import { fromAbortable } from '@deployer/effect-core'

import { engineMessage, isNotFound } from '../errors/classify'
import { DockerNotFound, DockerUnavailable } from '../errors/errors'

/**
 * Runs one engine call. Interrupting the effect aborts the request in flight when the call passes
 * `signal` on (dockerode takes it as `abortSignal` in the call's options); a call that ignores it is
 * simply no longer awaited. A 404 becomes `DockerNotFound` naming `resource` (when the caller says what
 * it asked for); anything else is `DockerUnavailable` saying which `operation` failed and why.
 */
export function engineCall<A>(
    operation: string,
    run: (signal: AbortSignal) => Promise<A>,
    resource?: string
): Effect.Effect<A, DockerNotFound | DockerUnavailable> {
    return fromAbortable(
        (signal) => run(signal),
        (cause) => cause
    ).pipe(
        Effect.mapError((cause) =>
            resource !== undefined && isNotFound(cause)
                ? new DockerNotFound({ resource, cause })
                : new DockerUnavailable({
                      reason: `Failed to ${operation}: ${engineMessage(cause)}`,
                      cause,
                  })
        )
    )
}
