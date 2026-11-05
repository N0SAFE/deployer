import type { SystemMetricsSnapshot } from '@deployer/contracts-entities'

import type { Readings } from './readings'

/** Shapes one sampling into the contract's snapshot: totals summed, per-item lists mapped, this process picked out. */
export function toSnapshot(
    readings: Readings,
    pid: number,
    capturedAt: Date
): SystemMetricsSnapshot {
    const { cpu, load, mem, fsSize, networkStats, graphics, processes } =
        readings

    const diskTotals = fsSize.reduce(
        (acc, entry) => ({
            size: acc.size + entry.size,
            used: acc.used + entry.used,
            available: acc.available + entry.available,
        }),
        { size: 0, used: 0, available: 0 }
    )
    const diskUse =
        diskTotals.size > 0 ? (diskTotals.used / diskTotals.size) * 100 : 0

    const networkTotals = networkStats.reduce(
        (acc, entry) => ({
            rxBytes: acc.rxBytes + entry.rx_bytes,
            txBytes: acc.txBytes + entry.tx_bytes,
            rxDropped: acc.rxDropped + entry.rx_dropped,
            txDropped: acc.txDropped + entry.tx_dropped,
            rxErrors: acc.rxErrors + entry.rx_errors,
            txErrors: acc.txErrors + entry.tx_errors,
        }),
        {
            rxBytes: 0,
            txBytes: 0,
            rxDropped: 0,
            txDropped: 0,
            rxErrors: 0,
            txErrors: 0,
        }
    )

    const currentProcess =
        processes.list.find((entry) => entry.pid === pid) ?? null

    return {
        capturedAt: capturedAt.toISOString(),
        cpu: {
            manufacturer: cpu.manufacturer,
            brand: cpu.brand,
            speed: cpu.speed,
            cores: cpu.cores,
            physicalCores: cpu.physicalCores,
            load: {
                currentLoad: load.currentLoad,
                currentLoadUser: load.currentLoadUser,
                currentLoadSystem: load.currentLoadSystem,
                currentLoadIdle: load.currentLoadIdle,
                cpus: load.cpus.map((cpuLoad) => ({
                    load: cpuLoad.load,
                    loadUser: cpuLoad.loadUser,
                    loadSystem: cpuLoad.loadSystem,
                    loadIdle: cpuLoad.loadIdle,
                })),
            },
        },
        memory: {
            total: mem.total,
            free: mem.free,
            used: mem.used,
            active: mem.active,
            available: mem.available,
            buffcache: mem.buffcache,
            swaptotal: mem.swaptotal,
            swapused: mem.swapused,
            swapfree: mem.swapfree,
        },
        disk: {
            totals: {
                size: diskTotals.size,
                used: diskTotals.used,
                available: diskTotals.available,
                use: diskUse,
            },
            filesystems: fsSize.map((entry) => ({
                fs: entry.fs,
                type: entry.type,
                size: entry.size,
                used: entry.used,
                available: entry.available,
                use: entry.use,
                mount: entry.mount,
                rw: entry.rw,
            })),
        },
        network: {
            totals: networkTotals,
            interfaces: networkStats.map((entry) => ({
                iface: entry.iface,
                operstate: entry.operstate,
                rxBytes: entry.rx_bytes,
                txBytes: entry.tx_bytes,
                rxDropped: entry.rx_dropped,
                txDropped: entry.tx_dropped,
                rxErrors: entry.rx_errors,
                txErrors: entry.tx_errors,
                rxSec: entry.rx_sec,
                txSec: entry.tx_sec,
            })),
        },
        process: currentProcess
            ? {
                  pid: currentProcess.pid,
                  name: currentProcess.name,
                  cpu: currentProcess.cpu,
                  mem: currentProcess.mem,
                  command: currentProcess.command,
                  started: currentProcess.started,
              }
            : null,
        gpu: {
            controllers: graphics.controllers.map((controller) => ({
                vendor: controller.vendor,
                model: controller.model,
                bus: controller.bus,
                vram: controller.vram,
                vramDynamic: controller.vramDynamic,
                fanSpeed: controller.fanSpeed,
                memoryTotal: controller.memoryTotal,
                memoryUsed: controller.memoryUsed,
                memoryFree: controller.memoryFree,
                utilizationGpu: controller.utilizationGpu,
                utilizationMemory: controller.utilizationMemory,
                temperatureGpu: controller.temperatureGpu,
                temperatureMemory: controller.temperatureMemory,
                powerDraw: controller.powerDraw,
                powerLimit: controller.powerLimit,
                clockCore: controller.clockCore,
                clockMemory: controller.clockMemory,
            })),
        },
    }
}
