import { describe, expect, it } from 'vitest'

import {
    DEFAULT_SCAN_CONCURRENCY_CEILING,
    planScanConcurrency,
    readScanPressure,
    resolveScanConcurrencyCeiling,
    type ScanPressure,
} from './scan-concurrency'

const HEALTHY: ScanPressure = {
    memAvailableRatio: 0.6,
    swapUsedRatio: 0,
    loadPerCore: 0.2,
}

const IDLE_HEAVY = { scan: 0, build: 0, deploy: 0 } as const

describe('planScanConcurrency', () => {
    it('uses the full ceiling only when the box has headroom and nothing heavy is running', () => {
        const plan = planScanConcurrency({
            ceiling: 3,
            pressure: HEALTHY,
            heavy: IDLE_HEAVY,
        })

        expect(plan).toEqual({ concurrency: 3, reason: 'headroom' })
    })

    it('collapses to one scanner when a build or a deployment is in flight', () => {
        for (const heavy of [
            { ...IDLE_HEAVY, build: 1 },
            { ...IDLE_HEAVY, deploy: 1 },
        ]) {
            expect(
                planScanConcurrency({ ceiling: 3, pressure: HEALTHY, heavy })
            ).toEqual({ concurrency: 1, reason: 'build-or-deploy-in-flight' })
        }
    })

    it('spends a slot per scan already running, so two images cannot each take the ceiling', () => {
        expect(
            planScanConcurrency({
                ceiling: 3,
                pressure: HEALTHY,
                heavy: { ...IDLE_HEAVY, scan: 1 },
            }).concurrency
        ).toBe(2)
    })

    it('stops at one under critical memory or swap pressure', () => {
        expect(
            planScanConcurrency({
                ceiling: 3,
                pressure: { ...HEALTHY, memAvailableRatio: 0.05 },
                heavy: IDLE_HEAVY,
            })
        ).toEqual({ concurrency: 1, reason: 'critical-memory' })

        expect(
            planScanConcurrency({
                ceiling: 3,
                pressure: { ...HEALTHY, swapUsedRatio: 0.8 },
                heavy: IDLE_HEAVY,
            })
        ).toEqual({ concurrency: 1, reason: 'swap-pressure' })
    })

    it('reduces to two on soft memory pressure and to one under CPU load', () => {
        expect(
            planScanConcurrency({
                ceiling: 3,
                pressure: { ...HEALTHY, memAvailableRatio: 0.2 },
                heavy: IDLE_HEAVY,
            }).concurrency
        ).toBe(2)

        expect(
            planScanConcurrency({
                ceiling: 3,
                pressure: { ...HEALTHY, loadPerCore: 1.4 },
                heavy: IDLE_HEAVY,
            }).concurrency
        ).toBe(1)
    })

    it('never returns less than one, whatever the pressure says', () => {
        const plan = planScanConcurrency({
            ceiling: 1,
            pressure: {
                memAvailableRatio: 0.01,
                swapUsedRatio: 0.99,
                loadPerCore: 9,
            },
            heavy: { scan: 5, build: 2, deploy: 2 },
        })

        expect(plan.concurrency).toBe(1)
    })
})

describe('resolveScanConcurrencyCeiling', () => {
    it('reads the env value as a 1..3 ceiling and falls back to the default', () => {
        expect(resolveScanConcurrencyCeiling({})).toBe(
            DEFAULT_SCAN_CONCURRENCY_CEILING
        )
        expect(
            resolveScanConcurrencyCeiling({
                APP_DOCKER_IMAGE_SCAN_PARALLELISM: '2',
            })
        ).toBe(2)
        expect(
            resolveScanConcurrencyCeiling({
                APP_DOCKER_IMAGE_SCAN_PARALLELISM: '9',
            })
        ).toBe(3)
        expect(
            resolveScanConcurrencyCeiling({
                APP_DOCKER_IMAGE_SCAN_PARALLELISM: '0',
            })
        ).toBe(1)
        expect(
            resolveScanConcurrencyCeiling({
                APP_DOCKER_IMAGE_SCAN_PARALLELISM: 'nope',
            })
        ).toBe(DEFAULT_SCAN_CONCURRENCY_CEILING)
    })
})

describe('readScanPressure', () => {
    it('reports usable ratios for this host', () => {
        const pressure = readScanPressure()

        expect(pressure.memAvailableRatio).toBeGreaterThan(0)
        expect(pressure.memAvailableRatio).toBeLessThanOrEqual(1)
        expect(pressure.swapUsedRatio).toBeGreaterThanOrEqual(0)
        expect(pressure.swapUsedRatio).toBeLessThanOrEqual(1)
        expect(Number.isFinite(pressure.loadPerCore)).toBe(true)
    })
})
