import { readFileSync } from 'node:fs'
import { cpus, freemem, loadavg, totalmem } from 'node:os'

import {
    heavyWorkSnapshot,
    type HeavyWorkKind,
} from '@deployer/shared/core/utils/heavy-work.registry'

/**
 * How many scanners may run for ONE image, right now.
 *
 * ── WHY THIS IS COMPUTED AND NOT A CONSTANT ─────────────────────────────────
 * The number that keeps the machine healthy is not a property of the code, it is
 * a property of the moment: a scan that runs alongside a deployment build is the
 * case that took the dev host into 25 GB of swap, where `docker ps` itself stopped
 * answering and the UI hung with it. A fixed 3 ignored the deployment; a fixed 1
 * wastes an idle 64-core box.
 *
 * So the value is derived from three things each call:
 *
 *  1. **What else is running** (`beginHeavyWork`): every active scan, build and
 *     deployment consumes one slot of the ceiling.
 *  2. **Memory headroom**: `MemAvailable` and swap pressure from `/proc/meminfo`.
 *     Swap being used at all is a warning; over half is a stop sign.
 *  3. **CPU headroom**: 1-minute load per core.
 *
 * The env value is the CEILING, not the answer.
 */

export const DEFAULT_SCAN_CONCURRENCY_CEILING = 3
const MIN_CONCURRENCY = 1

export interface ScanPressure {
    /** `MemAvailable / MemTotal`, 0..1. 1 = nothing used. */
    memAvailableRatio: number
    /** `SwapUsed / SwapTotal`, 0..1. 0 when the host has no swap. */
    swapUsedRatio: number
    /** 1-minute load average divided by the CPU count. */
    loadPerCore: number
}

export interface ScanConcurrencyPlan {
    concurrency: number
    reason: string
}

export interface PlanScanConcurrencyInput {
    ceiling: number
    pressure: ScanPressure
    heavy: Readonly<Record<HeavyWorkKind, number>>
}

/**
 * Pure decision function — every rule is testable without touching a host.
 *
 * Order matters: hard safety caps first, then the slot budget, then the softer
 * memory/CPU caps. `heavy.scan` is included so two images scanned at the same
 * time still share one budget instead of each getting the ceiling.
 */
export function planScanConcurrency({
    ceiling,
    pressure,
    heavy,
}: PlanScanConcurrencyInput): ScanConcurrencyPlan {
    const cap = Math.min(
        DEFAULT_SCAN_CONCURRENCY_CEILING,
        Math.max(MIN_CONCURRENCY, Math.trunc(ceiling))
    )

    if (pressure.memAvailableRatio < 0.12) {
        return { concurrency: 1, reason: 'critical-memory' }
    }

    if (pressure.swapUsedRatio > 0.5) {
        return { concurrency: 1, reason: 'swap-pressure' }
    }

    // One slot per unit of competing work. A deployment or a build is heavier and
    // longer than a scanner, so either one collapses this scan to serial.
    const competing = heavy.build + heavy.deploy
    if (competing > 0) {
        return { concurrency: 1, reason: 'build-or-deploy-in-flight' }
    }

    let budget = cap - heavy.scan

    if (pressure.loadPerCore > 1) {
        budget = Math.min(budget, 1)
    } else if (pressure.memAvailableRatio < 0.25) {
        budget = Math.min(budget, 2)
    }

    const concurrency = Math.min(cap, Math.max(MIN_CONCURRENCY, budget))

    return {
        concurrency,
        reason: concurrency === cap ? 'headroom' : 'reduced',
    }
}

/** The env value is the CEILING (1..3); the plan decides below it. */
export function resolveScanConcurrencyCeiling(
    env: NodeJS.ProcessEnv = process.env
): number {
    const raw = env.APP_DOCKER_IMAGE_SCAN_PARALLELISM
    const parsed =
        typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN

    if (!Number.isFinite(parsed)) {
        return DEFAULT_SCAN_CONCURRENCY_CEILING
    }

    return Math.min(
        DEFAULT_SCAN_CONCURRENCY_CEILING,
        Math.max(MIN_CONCURRENCY, parsed)
    )
}

interface LinuxMemory {
    totalKb: number
    availableKb: number
    swapTotalKb: number
    swapFreeKb: number
}

/**
 * `/proc/meminfo` is the only portable-to-us source of `MemAvailable` and swap;
 * `os.freemem()` reports strictly-free pages and would call a healthy Linux box
 * "critical" because of the page cache.
 */
function readLinuxMemory(): LinuxMemory | null {
    try {
        const raw = readFileSync('/proc/meminfo', 'utf8')
        const read = (key: string): number => {
            const match = new RegExp(`^${key}:\\s+(\\d+) kB`, 'm').exec(raw)
            return match?.[1] === undefined ? 0 : Number(match[1])
        }

        const totalKb = read('MemTotal')
        if (totalKb <= 0) {
            return null
        }

        return {
            totalKb,
            availableKb: read('MemAvailable'),
            swapTotalKb: read('SwapTotal'),
            swapFreeKb: read('SwapFree'),
        }
    } catch {
        return null
    }
}

/**
 * Test seam: a queue gate that reads the real host makes every test depend on the
 * machine running it (a swapping laptop would serialise a suite that asserts
 * otherwise). Production never sets this.
 */
let pressureOverride: ScanPressure | null = null

export function setScanPressureForTests(pressure: ScanPressure | null): void {
    pressureOverride = pressure
}

export function readScanPressure(): ScanPressure {
    if (pressureOverride !== null) {
        return pressureOverride
    }

    const cores = Math.max(1, cpus().length)
    const memory = readLinuxMemory()

    const memAvailableRatio =
        memory === null
            ? freemem() / Math.max(1, totalmem())
            : memory.availableKb / memory.totalKb

    const swapUsedRatio =
        memory === null || memory.swapTotalKb <= 0
            ? 0
            : (memory.swapTotalKb - memory.swapFreeKb) / memory.swapTotalKb

    // `loadavg()` is 0,0,0 on platforms that do not implement it (Windows).
    const load = loadavg()[0] ?? 0

    return {
        memAvailableRatio,
        swapUsedRatio,
        loadPerCore: load / cores,
    }
}

/** Pressure + what else is running + the env ceiling → the plan for this scan. */
export function planScanConcurrencyNow(
    env: NodeJS.ProcessEnv = process.env
): ScanConcurrencyPlan {
    return planScanConcurrency({
        ceiling: resolveScanConcurrencyCeiling(env),
        pressure: readScanPressure(),
        heavy: heavyWorkSnapshot(),
    })
}
