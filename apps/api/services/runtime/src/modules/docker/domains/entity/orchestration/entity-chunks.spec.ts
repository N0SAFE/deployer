import { describe, expect, it, vi } from 'vitest'

import {
    buildInspectChunk,
    buildListChunks,
    coerceStreamChunk,
    validateEntityBase,
} from './entity-chunks'

const log = () => ({ warn: vi.fn(), debug: vi.fn() })
const at = '2026-10-01T00:00:00.000Z'
const network = (id: string) => ({
    id,
    name: id,
    driver: 'bridge',
    scope: 'local',
    internal: false,
    attachable: true,
    subnet: null,
    gateway: null,
    containerIds: [],
    labels: {},
    createdAt: at,
    updatedAt: at,
})

describe('entity chunks', () => {
    it('validates an entity against its kind and reports one that does not fit', () => {
        const sink = log()
        expect(validateEntityBase('network', network('n1'), sink)?.id).toBe(
            'n1'
        )
        expect(validateEntityBase('network', { id: 5 }, sink)).toBeNull()
        expect(sink.warn).toHaveBeenCalledTimes(1)
        expect(
            validateEntityBase('registry' as never, network('n1'), sink)
        ).toBeNull()
    })

    it('builds one snapshot chunk per valid entity and skips the rest', () => {
        const sink = log()
        const chunks = buildListChunks(
            'network',
            [network('a'), { nope: true }, network('b')],
            at,
            sink
        )
        expect(
            chunks.map(
                (chunk) => (chunk as { kind: string; action: string }).action
            )
        ).toEqual(['snapshot', 'snapshot'])
        expect(chunks).toHaveLength(2)
        expect(sink.warn).toHaveBeenCalledTimes(1)
    })

    it('builds an inspect chunk, or null for a missing or invalid entity', () => {
        const sink = log()
        expect(
            buildInspectChunk('network', network('a'), at, sink)
        ).toMatchObject({ kind: 'network', action: 'snapshot' })
        expect(buildInspectChunk('network', null, at, sink)).toBeNull()
        expect(buildInspectChunk('network', { id: 1 }, at, sink)).toBeNull()
    })

    it('coerces a streamed chunk, dropping one that breaks the contract', () => {
        const sink = log()
        expect(
            coerceStreamChunk(
                {
                    kind: 'network',
                    action: 'destroy',
                    id: 'n1',
                    occurredAt: at,
                    eventId: null,
                },
                sink
            )
        ).toMatchObject({ id: 'n1' })
        expect(coerceStreamChunk({ kind: 'network' }, sink)).toBeNull()
        expect(sink.debug).toHaveBeenCalledTimes(1)
    })
})
