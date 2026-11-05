import { describe, expect, it } from 'vitest'

import {
    buildEventChunk,
    buildRemovedChunk,
    buildStreamFilter,
    eventMatchesFilter,
    fingerprintEtag,
    isRemovalAction,
    poolKeyFor,
} from './entity-stream-rules'

const event = (over: Record<string, unknown> = {}) =>
    ({
        source: 'container',
        action: 'start',
        actorId: 'c1',
        eventId: 'e1',
        timestamp: '2026-10-01T00:00:00.000Z',
        ...over,
    }) as never

describe('entity stream rules', () => {
    it('shares a pool key between subscriptions with the same kinds, in any order', () => {
        expect(poolKeyFor({ kinds: ['volume', 'container'] })).toBe(
            poolKeyFor({ kinds: ['container', 'volume'] })
        )
        expect(poolKeyFor({})).toContain('container,image,network,volume')
        expect(poolKeyFor({ kinds: ['container'] })).not.toBe(
            poolKeyFor({ kinds: ['image'] })
        )
    })

    it('builds one clause per kind, adding an action list only when one is given', () => {
        expect(
            buildStreamFilter({
                kinds: ['container'],
                actions: { container: ['start'] },
            })
        ).toEqual({
            source: { operator: 'eq', value: 'container' },
            action: { operator: 'in', value: ['start'] },
        })
        expect(buildStreamFilter({ kinds: ['container', 'image'] })).toEqual({
            _or: [
                { source: { operator: 'eq', value: 'container' } },
                { source: { operator: 'eq', value: 'image' } },
            ],
        })
        expect(buildStreamFilter({ kinds: [] })).toBeUndefined()
    })

    it('matches an event on its source and its action list', () => {
        const filter = {
            source: { operator: 'eq', value: 'container' },
            action: { operator: 'in', value: ['start'] },
        }
        expect(eventMatchesFilter(event(), filter)).toBe(true)
        expect(eventMatchesFilter(event({ action: 'stop' }), filter)).toBe(
            false
        )
        expect(eventMatchesFilter(event({ source: 'image' }), filter)).toBe(
            false
        )
        expect(eventMatchesFilter(event(), undefined)).toBe(true)
    })

    it('knows which actions remove an entity, per source', () => {
        expect(isRemovalAction('container', 'die')).toBe(true)
        expect(isRemovalAction('container', 'delete')).toBe(false)
        expect(isRemovalAction('image', 'delete')).toBe(true)
        expect(isRemovalAction('network', 'remove')).toBe(true)
        expect(isRemovalAction('volume', 'remove')).toBe(false)
    })

    it('builds a removal chunk and an entity chunk from an event', () => {
        expect(
            buildRemovedChunk('container', event({ action: 'die' }), 'c1')
        ).toEqual({
            kind: 'container',
            action: 'die',
            id: 'c1',
            occurredAt: '2026-10-01T00:00:00.000Z',
            eventId: 'e1',
        })
        expect(fingerprintEtag({ a: 'xyz 1' })).toMatch(/^"[a-z0-9]+"$/i)
        expect(() => buildEventChunk('container', {}, event())).toThrow()
    })
})
