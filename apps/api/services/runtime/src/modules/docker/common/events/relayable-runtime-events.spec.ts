import { firstValueFrom, from, toArray } from 'rxjs'
import { describe, expect, it } from 'vitest'

import { relayableRuntimeEvents } from './relayable-runtime-events'

describe('relayableRuntimeEvents', () => {
    it('passes every source except swarm tasks', async () => {
        const events = [
            'container',
            'image',
            'network',
            'volume',
            'service',
            'daemon',
            'node',
            'secret',
            'config',
            'builder',
            'unknown',
            'task',
        ].map((source) => ({ source }) as never)
        const relayed = await firstValueFrom(
            relayableRuntimeEvents(from(events)).pipe(toArray())
        )
        expect(relayed.map((event) => event.source)).toEqual([
            'container',
            'image',
            'network',
            'volume',
            'service',
            'daemon',
            'node',
            'secret',
            'config',
            'builder',
            'unknown',
        ])
    })
})
