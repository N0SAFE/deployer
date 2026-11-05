import { describe, expect, it } from 'vitest'

import {
    detectWatchModeFromLabels,
    extractRootFsLayers,
    toHealthcheckSeconds,
} from './container-inspect-reading'

describe('container inspect reading', () => {
    it('reads layers from either casing of RootFS and tolerates a single string', () => {
        expect(
            extractRootFsLayers({ RootFS: { Layers: ['a', '', 'b'] } })
        ).toEqual(['a', 'b'])
        expect(extractRootFsLayers({ RootFs: { layers: 'only' } })).toEqual([
            'only',
        ])
        expect(extractRootFsLayers({ RootFS: {} })).toEqual([])
        expect(extractRootFsLayers('nope')).toEqual([])
    })

    it('detects the watch tool from labels, keys or values, in precedence order', () => {
        expect(
            detectWatchModeFromLabels({ 'dev.cmd': 'run nodemon src' })
        ).toBe('nodemon')
        expect(detectWatchModeFromLabels({ vite: '1', turbo: '1' })).toBe(
            'vite'
        )
        expect(detectWatchModeFromLabels({ cmd: 'bun --watch' })).toBe('custom')
        expect(detectWatchModeFromLabels({ a: 'b' })).toBe('disabled')
    })

    it('turns nanosecond healthcheck timings into seconds, at least one', () => {
        expect(toHealthcheckSeconds(30_000_000_000)).toBe(30)
        expect(toHealthcheckSeconds(1)).toBe(1)
        expect(toHealthcheckSeconds(0)).toBeNull()
        expect(toHealthcheckSeconds(undefined)).toBeNull()
    })
})
