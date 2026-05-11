import { useMemo } from 'react'
import { createContextFilterDebugLogger } from '@/lib/logging/context-filter-debug'
import { type ContainerLogGroup, type LogLineProjection } from '../_models/logs.types'

const debugDockerLogsFilter = createContextFilterDebugLogger('DockerLogsFilterHook', 'docker-web-logs')

interface UseFilteredLogsParams {
  logs: LogLineProjection[]
  logsSearchTerm: string
  logsSourceFilter: 'all' | LogLineProjection['source']
  logsContainerFilter: string
  logsViewMode: 'single' | 'multi' | 'grouped'
  selectedContainerNames: Set<string>
  activeGroup: ContainerLogGroup | null
  clearedAt: number | null
}

export function useFilteredLogs({
  logs,
  logsSearchTerm,
  logsSourceFilter,
  logsContainerFilter,
  logsViewMode,
  selectedContainerNames,
  activeGroup,
  clearedAt,
}: UseFilteredLogsParams) {
  return useMemo(() => {
    const normalized = logsSearchTerm.trim().toLowerCase()
    const shouldApplySelectionFilter = logsContainerFilter === 'all' && selectedContainerNames.size > 0
    const activeSingleContainer =
      logsViewMode === 'single' && selectedContainerNames.size === 1
        ? Array.from(selectedContainerNames)[0]
        : null

    const dropReasons = {
      source: 0,
      container: 0,
      selection: 0,
      single: 0,
      group: 0,
      clearedAt: 0,
      search: 0,
    }

    const filtered = logs.filter((log) => {
      if (logsSourceFilter !== 'all' && log.source !== logsSourceFilter) {
        dropReasons.source += 1
        return false
      }
      if (logsContainerFilter !== 'all' && log.containerName !== logsContainerFilter) {
        dropReasons.container += 1
        return false
      }
      if (shouldApplySelectionFilter && !selectedContainerNames.has(log.containerName)) {
        dropReasons.selection += 1
        return false
      }
      if (activeSingleContainer && log.containerName !== activeSingleContainer) {
        dropReasons.single += 1
        return false
      }
      if (activeGroup && !activeGroup.containers.includes(log.containerName)) {
        dropReasons.group += 1
        return false
      }
      if (clearedAt && new Date(log.timestamp).getTime() < clearedAt) {
        dropReasons.clearedAt += 1
        return false
      }
      if (!normalized) {
        return true
      }

      const matchesSearch = (
        log.containerName.toLowerCase().includes(normalized)
        || log.message.toLowerCase().includes(normalized)
        || log.status.toLowerCase().includes(normalized)
      )

      if (!matchesSearch) {
        dropReasons.search += 1
      }

      return matchesSearch
    })

    debugDockerLogsFilter('filterEvaluation', {
      inputCount: logs.length,
      outputCount: filtered.length,
      logsSourceFilter,
      logsContainerFilter,
      logsViewMode,
      selectedContainers: selectedContainerNames.size,
      activeGroupId: activeGroup?.id ?? null,
      hasSearch: normalized.length > 0,
      dropReasons,
    })

    return filtered
  }, [activeGroup, clearedAt, logs, logsContainerFilter, logsSearchTerm, logsSourceFilter, logsViewMode, selectedContainerNames])
}
