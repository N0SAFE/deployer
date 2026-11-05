import { describe, expect, it } from 'vitest'

import {
    extractContainerSelector,
    matchesSelector,
    normalizePercent,
    readNumber,
    readString,
    sumNetworkBytes,
    toContainerMetricEvent,
} from './container-metrics'

describe('container metrics', () => {
    it('bounds a percentage and treats a non-finite one as zero', () => {
        expect(normalizePercent(150)).toBe(100)
        expect(normalizePercent(-5)).toBe(0)
        expect(normalizePercent(Number.NaN)).toBe(0)
        expect(normalizePercent(42)).toBe(42)
    })

    it('reads the first usable value from several candidate paths', () => {
        const source = { a: { b: 7 }, name: 'api' }
        expect(readNumber(source, ['missing', 'a.b'])).toBe(7)
        expect(readNumber(source, ['missing'])).toBe(0)
        expect(readString(source, ['nope', 'name'])).toBe('api')
    })

    it('sums a counter across every network interface', () => {
        expect(
            sumNetworkBytes(
                {
                    networks: {
                        eth0: { rx_bytes: 100 },
                        eth1: { rx_bytes: 50 },
                        bad: null,
                    },
                },
                'rx_bytes'
            )
        ).toBe(150)
        expect(sumNetworkBytes({}, 'tx_bytes')).toBe(0)
    })

    it('selects containers from the filter tree by id or name', () => {
        const selector = extractContainerSelector({
            _or: [
                { containerId: { operator: 'eq', value: 'abc123' } },
                { containerName: { operator: 'eq', value: 'api' } },
            ],
        })
        expect(selector).toEqual({
            containerIds: ['abc123'],
            containerNames: ['api'],
        })
        expect(extractContainerSelector(undefined)).toEqual({})
        // Both an id and a name filter are an AND: the container must satisfy each.
        expect(
            matchesSelector({ id: 'abc123456', name: 'api' } as never, selector)
        ).toBe(true)
        expect(
            matchesSelector(
                { id: 'abc123456', name: 'other' } as never,
                selector
            )
        ).toBe(false)
        expect(
            matchesSelector({ id: 'zzz', name: 'api' } as never, selector)
        ).toBe(false)
        expect(
            matchesSelector({ id: 'anything', name: 'x' } as never, {})
        ).toBe(true)
    })

    it('builds a metrics event from a stats sample, converting bytes to KB', () => {
        const event = toContainerMetricEvent(
            {
                id: 'c1',
                name: 'api',
                image: 'nginx',
                state: 'running',
                cpuPercent: 250,
                memPercent: 12.5,
                netRx: 2048,
                netTx: 1024,
            },
            undefined,
            '2026-10-01T00:00:00.000Z',
            1000
        )
        expect(event).toMatchObject({
            source: 'container',
            action: 'metrics',
            actorId: 'c1',
        })
        expect(event.payload).toMatchObject({
            containerName: 'api',
            metrics: { cpu: 100, memory: 12.5, networkRxKb: 2, networkTxKb: 1 },
        })
    })
})
