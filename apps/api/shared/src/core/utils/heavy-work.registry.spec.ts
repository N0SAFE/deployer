import { beforeEach, describe, expect, it } from 'vitest'

import {
    beginHeavyWork,
    heavyWorkSnapshot,
    resetHeavyWorkForTests,
} from './heavy-work.registry'

describe('heavy-work registry', () => {
    beforeEach(() => {
        resetHeavyWorkForTests()
    })

    it('counts work in flight per kind', () => {
        const releaseScan = beginHeavyWork('scan')
        beginHeavyWork('deploy')

        expect(heavyWorkSnapshot()).toEqual({ scan: 1, build: 0, deploy: 1 })

        releaseScan()
        expect(heavyWorkSnapshot()).toEqual({ scan: 0, build: 0, deploy: 1 })
    })

    it('ignores a double release, so a caller cannot unbalance the count', () => {
        const release = beginHeavyWork('build')
        release()
        release()

        expect(heavyWorkSnapshot().build).toBe(0)
    })

    it('never goes negative when released out of order', () => {
        const first = beginHeavyWork('scan')
        const second = beginHeavyWork('scan')

        second()
        first()
        first()

        expect(heavyWorkSnapshot().scan).toBe(0)
    })

    it('returns a copy, so a caller cannot mutate the counters', () => {
        beginHeavyWork('deploy')
        const snapshot = heavyWorkSnapshot() as { deploy: number }
        snapshot.deploy = 99

        expect(heavyWorkSnapshot().deploy).toBe(1)
    })
})
