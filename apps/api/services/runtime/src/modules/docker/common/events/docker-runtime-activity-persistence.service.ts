import { Context, Effect } from 'effect'
import { type Subscription, concatMap, from, EMPTY, catchError } from 'rxjs'

import { AppLogger } from '@deployer/logger'
import type { EffectHostShape } from '@deployer/nest-effect'

import { DockerRuntimeActivities } from '../../repositories/runtime/docker-runtime-activities'

import type { DockerRuntimeEventsStreamShape } from './docker-runtime-events-stream.service'

/** Persists every runtime event while it is started; it has no methods, only a lifetime. */
export type DockerRuntimeActivityPersistenceShape = {
    readonly onStart: () => Effect.Effect<void>
    readonly onStop: () => Effect.Effect<void>
}

/**
 * Adapter, not a domain service: the event source is still an Observable, so this only turns
 * "an event arrived" into "run this Effect". It stays on `EffectHost` for that reason; moving it to a
 * pure Effect would first require the events stream to become an Effect Stream, which its
 * `domains/**` consumers also read.
 */
export class DockerRuntimeActivityPersistenceService extends Context.Service<
    DockerRuntimeActivityPersistenceService,
    DockerRuntimeActivityPersistenceShape
>()('runtime/DockerRuntimeActivityPersistence') {
    static readonly make = makeDockerRuntimeActivityPersistence
}

function makeDockerRuntimeActivityPersistence(
    events: Pick<DockerRuntimeEventsStreamShape, 'observeEvents'>,
    host: Pick<EffectHostShape, 'runUnwrapped'>
): DockerRuntimeActivityPersistenceShape {
    const debugLogger = new AppLogger('api')
        .scope('DockerRuntimeActivityPersistenceService')
        .createContextFilterLogger({
            defaultClassName: 'DockerRuntimeActivityPersistenceService',
            filterEnvVar: 'APP_DEBUG_CONTEXT_FILTER',
            channel: 'docker-runtime-activity-persistence',
        })
    let subscription: Subscription | null = null

    return {
        onStart: () =>
            Effect.sync(() => {
                if (subscription) {
                    return
                }

                // Use concatMap to process events SEQUENTIALLY — prevents pool exhaustion
                // by ensuring each database insert completes before the next begins.
                // The fire-and-forget pattern (void + .catch()) caused concurrent inserts
                // that exhausted the 20-connection pool during event bursts (e.g. scan
                // progress updates), leading to cascading timeouts on all database queries.
                subscription = events
                    .observeEvents()
                    .pipe(
                        concatMap((event) =>
                            from(
                                host.runUnwrapped(
                                    Effect.gen(function* () {
                                        const activities =
                                            yield* DockerRuntimeActivities
                                        yield* activities.persist(event)
                                    })
                                )
                            ).pipe(
                                catchError((error: unknown) => {
                                    debugLogger.debug(
                                        'persist_runtime_activity_failed',
                                        {
                                            message:
                                                error instanceof Error
                                                    ? error.message
                                                    : String(error),
                                            source: event.source,
                                            action: event.action,
                                            eventId: event.eventId,
                                        }
                                    )
                                    return EMPTY
                                })
                            )
                        ),
                        catchError((error: unknown) => {
                            debugLogger.debug('runtime_event_stream_failed', {
                                message:
                                    error instanceof Error
                                        ? error.message
                                        : String(error),
                            })
                            return EMPTY
                        })
                    )
                    .subscribe()
            }),
        onStop: () =>
            Effect.sync(() => {
                subscription?.unsubscribe()
                subscription = null
            }),
    }
}
