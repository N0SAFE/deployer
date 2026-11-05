import { Subject, of } from 'rxjs'
import { describe, expect, it } from 'vitest'

import type { DockerRuntimeEvent } from '@deployer/contracts-entities'

import { DockerRuntimeMeshRelayService } from './docker-runtime-mesh-relay.service'

const event = (action: string): DockerRuntimeEvent =>
    ({
        source: 'container',
        type: 'container',
        action,
        actorId: 'a',
        actorAttributes: {},
        timestamp: new Date(0).toISOString(),
    }) as never

function collect<T>(source: {
    subscribe: (observer: (value: T) => void) => { unsubscribe: () => void }
}) {
    const seen: T[] = []
    const subscription = source.subscribe((value) => seen.push(value))
    return { seen, subscription }
}

describe('DockerRuntimeMeshRelayService', () => {
    it("merges this node's events, tagged with its id, with the other nodes' events", () => {
        const engine = new Subject<DockerRuntimeEvent>()
        const peers = new Subject<DockerRuntimeEvent>()
        const relay = new DockerRuntimeMeshRelayService(
            { stream: () => engine.asObservable() },
            {
                streamRuntimeEvents: () => peers.asObservable(),
                selfNodeId: () => 'node-a',
            }
        )

        const { seen, subscription } = collect(relay.observeRuntimeEvents())
        engine.next(event('start'))
        peers.next(event('die'))

        expect(seen.map((e) => e.action)).toEqual(['start', 'die'])
        expect(seen[0]?.actorAttributes).toMatchObject({ meshNodeId: 'node-a' })
        subscription.unsubscribe()
    })

    it("serves an event added by hand to the node's own stream", () => {
        const relay = new DockerRuntimeMeshRelayService(
            { stream: () => of() },
            { streamRuntimeEvents: () => of(), selfNodeId: () => undefined }
        )
        const { seen, subscription } = collect(relay.localEvents$())
        relay.relayRuntimeEvent(event('scan'))
        expect(seen.map((e) => e.action)).toEqual(['scan'])
        subscription.unsubscribe()
    })
})
