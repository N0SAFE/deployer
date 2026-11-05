import { Effect } from 'effect'
import { Subject } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'

import { dockerContainerRuntimeEventSchema } from '@deployer/contracts-entities'

import { DockerRuntimeEventsStreamService } from './docker-runtime-events-stream.service'

describe('DockerRuntimeEventsStreamService', () => {
    it('subscribes to the relay once on start and forwards runtime events', async () => {
        const relayEvents$ = new Subject<
            ReturnType<typeof dockerContainerRuntimeEventSchema.parse>
        >()

        const dockerRuntimeMeshRelayService = {
            observeRuntimeEvents: vi.fn(() => relayEvents$),
        }

        const service = DockerRuntimeEventsStreamService.make(
            dockerRuntimeMeshRelayService
        )

        const received: ReturnType<
            typeof dockerContainerRuntimeEventSchema.parse
        >[] = []
        const subscription = service.observeEvents().subscribe((event) => {
            received.push(
                event as ReturnType<
                    typeof dockerContainerRuntimeEventSchema.parse
                >
            )
        })

        await Effect.runPromise(service.onStart())
        await Effect.runPromise(service.onStart())

        relayEvents$.next(
            dockerContainerRuntimeEventSchema.parse({
                type: 'docker_event',
                source: 'container',
                action: 'create',
                actorId: 'ctr-stream-1',
                actorAttributes: {
                    meshNodeId: 'node-local',
                },
                scope: null,
                from: null,
                eventId: 'evt-stream-1',
                nodeId: null,
                timestamp: '2026-04-17T10:00:00.000Z',
                timestampNano: null,
                raw: {},
                payload: {
                    containerId: 'ctr-stream-1',
                    containerName: 'api',
                    image: 'repo/app:latest',
                    exitCode: null,
                    signal: null,
                },
            })
        )

        await Promise.resolve()

        expect(
            dockerRuntimeMeshRelayService.observeRuntimeEvents
        ).toHaveBeenCalledTimes(1)
        expect(received).toHaveLength(1)
        expect(received[0]?.action).toBe('create')

        await Effect.runPromise(service.onStop())
        subscription.unsubscribe()
        relayEvents$.complete()
    })
})
