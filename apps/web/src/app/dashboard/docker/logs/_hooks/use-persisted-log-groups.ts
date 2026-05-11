import { useEffect, useMemo, useState } from 'react'
import { LOG_GROUPS_STORAGE_KEY, type ContainerLogGroup } from '../_models/logs.types'

export function usePersistedLogGroups() {
  const [containerGroups, setContainerGroups] = useState<ContainerLogGroup[]>([])
  const [activeGroupId, setActiveGroupId] = useState<string>('all')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const raw = window.localStorage.getItem(LOG_GROUPS_STORAGE_KEY)
    if (!raw) return

    try {
      const parsed = JSON.parse(raw) as ContainerLogGroup[]
      if (Array.isArray(parsed)) {
        setContainerGroups(
          parsed
            .filter((group) => group && typeof group.id === 'string' && typeof group.name === 'string' && Array.isArray(group.containers))
            .map((group) => ({
              id: group.id,
              name: group.name,
              containers: group.containers.filter((container): container is string => typeof container === 'string'),
            })),
        )
      }
    } catch {
      // ignore invalid persisted data
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(LOG_GROUPS_STORAGE_KEY, JSON.stringify(containerGroups))
  }, [containerGroups])

  const activeGroup = useMemo(() => {
    if (activeGroupId === 'all') return null
    return containerGroups.find((group) => group.id === activeGroupId) ?? null
  }, [activeGroupId, containerGroups])

  return {
    containerGroups,
    setContainerGroups,
    activeGroupId,
    setActiveGroupId,
    activeGroup,
  }
}
