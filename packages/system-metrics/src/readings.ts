import type * as si from 'systeminformation'

/** What one sampling of the machine returns, before it is shaped into a snapshot. */
export type Readings = {
    readonly cpu: si.Systeminformation.CpuData
    readonly load: si.Systeminformation.CurrentLoadData
    readonly mem: si.Systeminformation.MemData
    readonly fsSize: readonly si.Systeminformation.FsSizeData[]
    readonly networkStats: readonly si.Systeminformation.NetworkStatsData[]
    readonly graphics: si.Systeminformation.GraphicsData
    readonly processes: si.Systeminformation.ProcessesData
}
