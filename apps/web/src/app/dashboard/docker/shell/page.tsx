'use client'

import { useMemo, useState } from 'react'
import { TerminalSquare } from 'lucide-react'
import { AuthDashboardDockerContainers } from '@/routes'
import { EmptyState } from '@/components/dashboard'
import { useDockerContainerList } from '@/domains/docker/hooks'
import { useDockerLiveRefetch } from '@/domains/docker/use-docker-live'
import { DockerEngineError } from '../_components/docker-engine-error'
import { DockerPageSkeleton } from '../_components/docker-loading-states'
import { useDockerNode } from '../_components/docker-node-context'
import { ShellSession } from './_components/shell-session'

const LIST_INPUT = { query: { limit: 100, offset: 0 } } as const

export default function DashboardDockerShellPage() {
  const { nodeName } = useDockerNode()
  const listQuery = useDockerContainerList(LIST_INPUT)
  const { refetch } = listQuery
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useDockerLiveRefetch({
    on: { container: ['create', 'destroy', 'die', 'start', 'stop', 'restart', 'rename'] },
    onData: () => { void refetch() },
    debounceMs: 900,
  })

  const running = useMemo(
    () => (listQuery.data?.data ?? [])
      .filter((container) => container.status === 'running')
      .sort((a, b) => a.name.localeCompare(b.name)),
    [listQuery.data],
  )
  const selected = running.find((container) => container.id === selectedId) ?? null

  if (listQuery.isLoading) return <DockerPageSkeleton label={`Loading containers on ${nodeName}…`} columns={2} />

  if (listQuery.isError && running.length === 0) {
    return <DockerEngineError what="containers" error={listQuery.error} onRetry={() => { void refetch() }} isRetrying={listQuery.isFetching} />
  }

  if (running.length === 0) {
    return (
      <EmptyState
        icon={TerminalSquare}
        title="No running containers on this node"
        description={<>A shell needs a running container. Start one from <AuthDashboardDockerContainers.Link className="underline">Containers</AuthDashboardDockerContainers.Link>.</>}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="shell-container" className="text-sm font-medium">Container on {nodeName}</label>
        <select
          id="shell-container"
          value={selected?.id ?? ''}
          onChange={(event) => { setSelectedId(event.target.value || null) }}
          className="h-8 min-w-56 rounded-md border border-border/70 bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
        >
          <option value="">Select a running container…</option>
          {running.map((container) => <option key={container.id} value={container.id}>{container.name}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">{running.length} running · stopped containers are not listed</span>
      </div>

      {selected ? (
        <ShellSession key={selected.id} containerId={selected.id} containerName={selected.name} />
      ) : (
        <EmptyState
          compact
          icon={TerminalSquare}
          title="Choose a container to open a shell"
          description="The shell runs inside the container with its privileges, not on the host. Nothing connects until you choose one."
        />
      )}
    </div>
  )
}
