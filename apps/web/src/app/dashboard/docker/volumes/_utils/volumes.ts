import type { DockerVolume } from '@repo/contracts-entities'

export type VolumeView = 'all' | 'active' | 'inactive'
export type VolumeSortKey = 'name' | 'updated' | 'state' | 'size'

export function isVolumeInUse(volume: Pick<DockerVolume, 'usedByContainerIds'>): boolean {
  return volume.usedByContainerIds.length > 0
}

export function filterVolumes(
  volumes: readonly DockerVolume[],
  { query, view }: { query: string; view: VolumeView },
): DockerVolume[] {
  const needle = query.trim().toLowerCase()
  return volumes.filter((volume) => {
    const inUse = isVolumeInUse(volume)
    if (view === 'active' && !inUse) return false
    if (view === 'inactive' && inUse) return false
    if (!needle) return true
    return (
      volume.name.toLowerCase().includes(needle)
      || volume.driver.includes(needle)
      || (volume.mountpoint ?? '').toLowerCase().includes(needle)
      || (volume.labels.serviceId ?? '').toLowerCase().includes(needle)
      || (volume.labels.projectId ?? '').toLowerCase().includes(needle)
    )
  })
}

/** Total of the sizes the engine reported; `null` when none reported one (never a fake 0). */
export function totalReportedBytes(volumes: readonly Pick<DockerVolume, 'sizeBytes'>[]): number | null {
  let total = 0
  let any = false
  for (const volume of volumes) {
    if (volume.sizeBytes !== null) {
      total += volume.sizeBytes
      any = true
    }
  }
  return any ? total : null
}
