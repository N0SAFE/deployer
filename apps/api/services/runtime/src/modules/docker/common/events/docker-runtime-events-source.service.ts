import { Logger } from '@nestjs/common'
import { Cause, Effect, Fiber, Stream } from 'effect'
import { Observable, defer, retry, share, timer } from 'rxjs'

import { type DockerRuntimeEvent } from '@deployer/contracts-entities'
import type { DockerEngineShape } from '@deployer/docker'
import type { DockerRuntimeEventsStreamQueryInput } from '@deployer/runtime-contracts/modules/docker/runtime/shared'
import { AbstractDomainEventStreamService } from '@deployer/shared/core/modules/events/base/index'
import { type CoreEventStreamPoolServiceShape } from '@deployer/shared/core/modules/events/base/index'
import { isRecord } from '@deployer/type-guards'

import { isRuntimeEventFilterNode } from '../runtime/runtime-event-filter'

import {
    buildGetEventsOptions,
    buildStreamPoolKey,
    mapDockerEvent,
    formatError,
    extractFastPathFilters,
    type StreamQuery,
} from './docker-event-mapping'

export class DockerRuntimeEventsSourceService extends AbstractDomainEventStreamService {
    protected readonly streamDomain = 'docker'
    private readonly logger = new Logger(DockerRuntimeEventsSourceService.name)

    constructor(
        private readonly dockerEngine: DockerEngineShape,
        streamPool: CoreEventStreamPoolServiceShape
    ) {
        super(streamPool)
    }

    stream(
        query: DockerRuntimeEventsStreamQueryInput
    ): Observable<DockerRuntimeEvent> {
        const rawQuery = isRecord(query) ? query : {}
        const filter = isRuntimeEventFilterNode(rawQuery.filter)
            ? rawQuery.filter
            : undefined
        const fastPath = extractFastPathFilters(filter)

        const streamQuery: StreamQuery = {
            since:
                typeof rawQuery.since === 'string' ? rawQuery.since : undefined,
            until:
                typeof rawQuery.until === 'string' ? rawQuery.until : undefined,
            sources: fastPath.sources,
            actions: fastPath.actions,
        }

        this.logger.log(
            `[docker-runtime-sse] stream request -> since=${streamQuery.since ?? ''} until=${streamQuery.until ?? ''} sources=${JSON.stringify(streamQuery.sources ?? [])} actions=${JSON.stringify(streamQuery.actions ?? [])}`
        )

        return this.observeDomainPooledStream(
            buildStreamPoolKey(streamQuery),
            () => this.createRetryableStream(streamQuery)
        )
    }

    private createRetryableStream(
        query: StreamQuery
    ): Observable<DockerRuntimeEvent> {
        return defer(() => this.createDockerEventsStream(query)).pipe(
            retry({
                delay: (error, retryCount) => {
                    const delayMs = Math.min(1000 * 2 ** retryCount, 10000)
                    this.logger.warn(
                        `Docker event stream disconnected (${formatError(
                            error
                        )}). Retrying in ${String(delayMs)}ms`
                    )
                    return timer(delayMs)
                },
            }),
            share()
        )
    }

    private createDockerEventsStream(
        query: StreamQuery
    ): Observable<DockerRuntimeEvent> {
        const getEventsOptions = buildGetEventsOptions(query)

        this.logger.log(
            `[docker-runtime-sse] docker.getEvents options=${JSON.stringify(getEventsOptions)}`
        )

        const events = this.dockerEngine.events

        return new Observable<DockerRuntimeEvent>((subscriber) => {
            const fiber = Effect.runFork(
                events.stream(getEventsOptions).pipe(
                    Stream.runForEach((event) =>
                        Effect.sync(() => {
                            subscriber.next(mapDockerEvent(event))
                        })
                    ),
                    Effect.matchCause({
                        onSuccess: () => {
                            subscriber.complete()
                        },
                        onFailure: (cause) => {
                            subscriber.error(Cause.squash(cause))
                        },
                    })
                )
            )
            // Interrupting the fiber releases the engine connection.
            return () => {
                void Effect.runPromise(Fiber.interrupt(fiber))
            }
        })
    }
}
