'use client'

import { useCallback, useMemo } from 'react'
import { Boxes } from 'lucide-react'
import { EmptyState } from '@/components/dashboard'
import { useDockerContainerList } from '@/domains/docker/hooks'
import { useDockerLiveRefetch } from '@/domains/docker/use-docker-live'
import { DockerEngineError } from '../_components/docker-engine-error'
import { useDockerNode } from '../_components/docker-node-context'
import { DockerPageSkeleton } from '../_components/docker-loading-states'
import { LogsWorkspace, type LogsContainer } from './_components/logs-workspace'

const CONTAINER_LIST_INPUT = { query: { limit: 100, offset: 0 } } as const

export default function DashboardDockerLogsPage() {
  const { nodeName } = useDockerNode()
  const containerListQuery = useDockerContainerList(CONTAINER_LIST_INPUT)
  const { refetch } = containerListQuery

  const handleLiveUpdate = useCallback(() => { void refetch() }, [refetch])
  useDockerLiveRefetch({
    on: { container: ['create', 'update', 'destroy', 'die', 'start', 'stop', 'restart'] },
    onData: handleLiveUpdate,
    debounceMs: 900,
  })

  const containers = useMemo<LogsContainer[]>(
    () => (containerListQuery.data?.data ?? [])
      .map((container) => ({ id: container.id, name: container.name, status: container.status }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [containerListQuery.data],
  )

  if (containerListQuery.isLoading) {
    return <DockerPageSkeleton label={`Loading containers on ${nodeName}…`} columns={3} />
  }

  if (containerListQuery.isError && containers.length === 0) {
    return (
      <DockerEngineError
        what="containers"
        error={containerListQuery.error}
        onRetry={() => { void refetch() }}
        isRetrying={containerListQuery.isFetching}
      />
    )
  }

  if (containers.length === 0) {
    return (
      <EmptyState
        icon={Boxes}
        title={`No containers on ${nodeName}`}
        description="Logs are streamed per container. Deploy a service or start a container and it will appear here."
      />
    )
  }

  return <LogsWorkspace containers={containers} />
}
