'use client'

import { useMemo, useState } from 'react'
import { getMockOperationProgress } from '@/mocks/platform/entities/docker.large.mock'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Input } from '@repo/ui/components/shadcn/input'
import { Activity, Search } from 'lucide-react'
import type { DockerOperationProgressItem } from '@/mocks/platform/types'

function formatDate(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString()
}

function toBadgeVariant(status: DockerOperationProgressItem['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'success') return 'default'
  if (status === 'failed') return 'destructive'
  if (status === 'running') return 'secondary'
  return 'outline'
}

export default function DashboardDockerQueuPage() {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | DockerOperationProgressItem['status']>('all')

  const operations = useMemo<DockerOperationProgressItem[]>(() => {
    return (['containers', 'images', 'networks', 'volumes', 'registry', 'stacks'] as const)
      .flatMap((resourceType) => getMockOperationProgress(resourceType))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [])

  const filteredOperations = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    return operations.filter((operation) => {
      if (statusFilter !== 'all' && operation.status !== statusFilter) return false
      if (!query) return true
      return (
        operation.action.toLowerCase().includes(query)
        || operation.resourceName.toLowerCase().includes(query)
        || operation.resourceType.toLowerCase().includes(query)
      )
    })
  }, [operations, searchTerm, statusFilter])

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl">
        <div className="border-b border-border/60 px-5 py-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            <h2 className="text-sm font-semibold">Operation queu</h2>
            <Badge variant="outline">{filteredOperations.length}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Unified Docker action queue across containers, images, networks, volumes, registry and stacks.</p>
        </div>

        <div className="space-y-3 p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_180px]">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(event) => {
                  setSearchTerm(event.target.value)
                }}
                className="pl-9"
                placeholder="Search queue entries"
              />
            </div>
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as 'all' | DockerOperationProgressItem['status'])
              }}
            >
              <option value="all">All statuses</option>
              <option value="running">Running</option>
              <option value="queued">Queued</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          <div className="space-y-2">
            {filteredOperations.map((operation) => (
              <div key={operation.id} className="rounded-lg border border-border/60 bg-card/60 p-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="min-w-0 flex items-center gap-2">
                    <Badge variant="outline" className="uppercase text-[10px]">{operation.resourceType}</Badge>
                    <p className="truncate text-xs font-medium">{operation.action} · {operation.resourceName}</p>
                  </div>
                  <Badge variant={toBadgeVariant(operation.status)}>{operation.status}</Badge>
                </div>
                <div className="h-1.5 rounded bg-muted overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${String(operation.progress)}%` }} />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{operation.progress}% · {formatDate(operation.updatedAt)}</p>
              </div>
            ))}
            {filteredOperations.length === 0 ? (
              <p className="rounded border border-border/60 p-4 text-sm text-muted-foreground">No queued operation matches the current filters.</p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}
