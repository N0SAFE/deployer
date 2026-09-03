'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { DockerBatchOperationsBar, DockerSavedViewSelect } from '../_components/docker-operations-controls'
import { DockerInlineLoadingState, DockerTableLoadingRows } from '../_components/docker-loading-states'
import { DockerStackDetailModalTrigger } from '../_components/docker-stack-detail-modal'
import { DockerTablePagination } from '../_components/docker-table-pagination'
import {
  DockerActiveFilterChips,
  DockerColumnSettings,
  DockerExpandedTableRow,
  DockerExpandableRowToggle,
  DockerExportActions,
  DockerSelectionToggle,
} from '../_components/docker-page-utilities'
import { useDockerDataTable } from '../_components/use-docker-data-table'
import { useDockerStackList } from '@/domains/docker/hooks'
import { useDockerLiveRefetch } from '@/domains/docker/use-docker-live'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/shadcn/table'
import { Separator } from '@repo/ui/components/shadcn/separator'
import { Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useSafeQueryParamStatesFromZod } from '@repo/use-safe-query-param-states-from-zod'

const STACK_LIST_INPUT = {
  query: {
    limit: 100,
    offset: 0,
  },
} as const

const STACK_LIST_QUERY_SCHEMA = z.object({
  q: z.string().default(''),
  view: z.enum(['all', 'healthy', 'failed']).default('all'),
  sortBy: z.enum(['services', 'name', 'status', 'deployments']).default('services'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(100).default(20),
})

interface StackProjection {
  id: string
  name: string
  projectId: string
  serviceCount: number
  activeServices: number
  latestDeploymentStatus: string | null
  deploymentCount: number
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

function toBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const normalized = status.toLowerCase()
  if (normalized === 'success' || normalized === 'active' || normalized === 'healthy') return 'default'
  if (normalized === 'failed' || normalized === 'error' || normalized === 'down') return 'destructive'
  if (normalized === 'pending' || normalized === 'queued' || normalized === 'building' || normalized === 'deploying') {
    return 'secondary'
  }
  return 'outline'
}

export default function DashboardDockerStacksPage() {
  const [listQuery, setListQuery] = useSafeQueryParamStatesFromZod(STACK_LIST_QUERY_SCHEMA)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [expandedStackIds, setExpandedStackIds] = useState<Set<string>>(new Set())
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
    Stack: true,
    Project: true,
    Services: true,
    'Active services': true,
    Deployments: true,
    'Latest status': true,
  })

  const stackListQuery = useDockerStackList(STACK_LIST_INPUT)

  const searchTerm = listQuery.q
  const savedView = listQuery.view
  const sortBy = listQuery.sortBy
  const sortDirection = listQuery.sortDirection

  const handleContainerLiveUpdate = useCallback(() => {
    void stackListQuery.refetch()
  }, [stackListQuery])

  useDockerLiveRefetch({
    on: { container: ['create', 'update', 'destroy', 'die', 'start', 'stop', 'restart'] },
    onData: handleContainerLiveUpdate,
    debounceMs: 1000,
  })

  const { data: stackData } = stackListQuery
  const stackEntities = useMemo(() => stackData?.data ?? [], [stackData])

  const stacks = useMemo<StackProjection[]>(() => {
    return stackEntities
      .map((stack) => ({
        id: stack.id,
        name: stack.name,
        projectId: stack.projectId,
        serviceCount: stack.services.length,
        activeServices: stack.services.filter((service) => service.status === 'running').length,
        latestDeploymentStatus: stack.status,
        deploymentCount: stack.services.reduce((sum, service) => sum + service.replicas, 0),
      }))
      .sort((a, b) => b.serviceCount - a.serviceCount)
  }, [stackEntities])

  const stackById = useMemo(() => new Map(stackEntities.map((stack) => [stack.id, stack])), [stackEntities])

  const filteredStacks = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    const filtered = stacks.filter((stack) => {
      if (savedView === 'healthy' && stack.latestDeploymentStatus !== 'healthy') return false
      if (savedView === 'failed' && stack.latestDeploymentStatus !== 'failed') return false
      if (!query) return true
      return stack.name.toLowerCase().includes(query) || stack.projectId.toLowerCase().includes(query)
    })

    return filtered
  }, [savedView, searchTerm, stacks])

  const stackSorters = useMemo(
    () => ({
      services: (stack: StackProjection) => stack.serviceCount,
      name: (stack: StackProjection) => stack.name,
      status: (stack: StackProjection) => stack.latestDeploymentStatus ?? '',
      deployments: (stack: StackProjection) => stack.deploymentCount,
    }),
    [],
  )

  const stackTable = useDockerDataTable({
    data: filteredStacks,
    sortBy,
    sortDirection,
    page: listQuery.page,
    pageSize: listQuery.pageSize,
    sorters: stackSorters,
  })

  useEffect(() => {
    if (stackTable.page !== listQuery.page) {
      setListQuery({ page: stackTable.page })
    }
  }, [listQuery.page, setListQuery, stackTable.page])

  const visibleStacks = stackTable.rows

  const allVisibleSelected = visibleStacks.length > 0 && visibleStacks.every((stack) => selectedIds.has(stack.id))
  const selectedVisibleCount = visibleStacks.filter((stack) => selectedIds.has(stack.id)).length
  const someVisibleSelected = selectedVisibleCount > 0 && selectedVisibleCount < visibleStacks.length
  const healthyStacks = filteredStacks.filter((stack) => stack.latestDeploymentStatus === 'healthy').length
  const failedStacks = filteredStacks.filter((stack) => stack.latestDeploymentStatus === 'failed').length
  const visibleColumnCount = Object.values(visibleColumns).filter(Boolean).length
  const totalTableColumns = visibleColumnCount + 2
  const isInitialLoading = stackListQuery.isLoading && stacks.length === 0

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-border/60 bg-card/50 backdrop-blur-xl">
        <div className="border-b border-border/60 bg-background/70 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">Stacks</h2>
              <Badge variant="secondary" className="border border-border/70">{filteredStacks.length}</Badge>
            </div>

            <div className="grid w-full gap-2 md:w-auto md:grid-cols-[minmax(260px,1fr)_180px_180px_110px_auto_auto_auto]">
              <div className="relative min-w-65">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(event) => {
                    setListQuery({ q: event.target.value, page: 1 })
                  }}
                  placeholder="Search stacks..."
                  className="h-9 border-border/70 bg-background/70 pl-9"
                />
              </div>

              <DockerSavedViewSelect
                storageKey="docker:stacks:saved-view"
                value={savedView}
                onChange={(value) => {
                  setListQuery({ view: value as 'all' | 'healthy' | 'failed', page: 1 })
                }}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'healthy', label: 'Healthy' },
                  { value: 'failed', label: 'Failed' },
                ]}
              />

              <select aria-label="Sort: Services"
                className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm"
                value={sortBy}
                onChange={(event) => {
                  setListQuery({ sortBy: event.target.value as 'services' | 'name' | 'status' | 'deployments', page: 1 })
                }}
              >
                <option value="services">Sort: Services</option>
                <option value="deployments">Sort: Deployments</option>
                <option value="status">Sort: Status</option>
                <option value="name">Sort: Name</option>
              </select>

              <select aria-label="Desc"
                className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm"
                value={sortDirection}
                onChange={(event) => {
                  setListQuery({ sortDirection: event.target.value as 'asc' | 'desc', page: 1 })
                }}
              >
                <option value="desc">Desc</option>
                <option value="asc">Asc</option>
              </select>

              <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setActionFeedback('Remove selected stacks queued.') }>
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setActionFeedback('Stack state refreshed.') }>
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
              <Button type="button" size="sm" className="h-9 gap-1.5" onClick={() => setActionFeedback('Open create stack flow (pending API wiring).') }>
                <Plus className="h-3.5 w-3.5" />
                Create
              </Button>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <DockerActiveFilterChips
              chips={[
                ...(searchTerm ? [{ key: 'search', label: 'search', value: searchTerm }] : []),
                ...(savedView !== 'all' ? [{ key: 'saved-view', label: 'view', value: savedView }] : []),
              ]}
            />
            <div className="ml-auto">
              <DockerExportActions
                filenameBase="docker-stacks"
                rows={filteredStacks.map((stack) => ({
                  id: stack.id,
                  name: stack.name,
                  projectId: stack.projectId,
                  serviceCount: stack.serviceCount,
                  activeServices: stack.activeServices,
                  deploymentCount: stack.deploymentCount,
                  latestDeploymentStatus: stack.latestDeploymentStatus,
                }))}
              />
            </div>
          </div>
        </div>

        {actionFeedback ? <div className="border-b border-border/60 bg-muted/20 px-4 py-2 text-xs text-muted-foreground">{actionFeedback}</div> : null}

        {isInitialLoading ? (
          <div className="px-4 py-3">
            <DockerInlineLoadingState label="Loading stack topology and service health…" />
          </div>
        ) : null}

        <div className="p-4">

          <DockerBatchOperationsBar
            selectedCount={selectedIds.size}
            resourceLabel="stacks"
            onClearSelection={() => {
              setSelectedIds(new Set())
            }}
          />

          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <div className="flex h-7 items-center gap-1">
                    <DockerSelectionToggle
                      ariaLabel="Select all visible stacks"
                      pressed={allVisibleSelected}
                      indeterminate={someVisibleSelected}
                      onPressedChange={(pressed) => {
                        if (pressed) {
                          setSelectedIds(new Set(visibleStacks.map((stack) => stack.id)))
                        } else {
                          setSelectedIds(new Set())
                        }
                      }}
                    />
                    <Separator orientation="vertical" className="h-full bg-border/80" />
                  </div>
                </TableHead>
                {visibleColumns.Stack ? <TableHead>Stack</TableHead> : null}
                {visibleColumns.Project ? <TableHead>Project</TableHead> : null}
                {visibleColumns.Services ? <TableHead>Services</TableHead> : null}
                {visibleColumns['Active services'] ? <TableHead>Active services</TableHead> : null}
                {visibleColumns.Deployments ? <TableHead>Deployments</TableHead> : null}
                {visibleColumns['Latest status'] ? <TableHead>Latest status</TableHead> : null}
                <TableHead className="w-48">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isInitialLoading ? (
                <DockerTableLoadingRows columns={totalTableColumns} rows={6} />
              ) : visibleStacks.map((stack) => {
                const stackEntity = stackById.get(stack.id)
                const isExpanded = expandedStackIds.has(stack.id)

                return (
                <Fragment key={stack.id}>
                <TableRow key={stack.id}>
                  <TableCell>
                    <div className="flex h-7 items-center gap-1">
                      <DockerSelectionToggle
                        ariaLabel={`Select stack ${stack.name}`}
                        pressed={selectedIds.has(stack.id)}
                        onPressedChange={(pressed) => {
                          setSelectedIds((previous) => {
                            const next = new Set(previous)
                            if (pressed) {
                              next.add(stack.id)
                            } else {
                              next.delete(stack.id)
                            }
                            return next
                          })
                        }}
                      />
                      <Separator orientation="vertical" className="h-full bg-border/80" />
                    </div>
                  </TableCell>
                  {visibleColumns.Stack ? (
                    <TableCell className="font-mono text-xs">
                      <div className="flex items-center gap-2">
                        <DockerExpandableRowToggle
                          expanded={isExpanded}
                          ariaLabel={isExpanded ? `Collapse stack ${stack.name}` : `Expand stack ${stack.name}`}
                          onToggle={() => {
                            setExpandedStackIds((previous) => {
                              const next = new Set(previous)
                              if (next.has(stack.id)) next.delete(stack.id)
                              else next.add(stack.id)
                              return next
                            })
                          }}
                        />
                        <DockerStackDetailModalTrigger id={stack.id}>
                          {stack.name}
                        </DockerStackDetailModalTrigger>
                      </div>
                    </TableCell>
                  ) : null}
                  {visibleColumns.Project ? <TableCell className="font-mono text-xs">{shortId(stack.projectId)}</TableCell> : null}
                  {visibleColumns.Services ? <TableCell>{stack.serviceCount}</TableCell> : null}
                  {visibleColumns['Active services'] ? <TableCell>{stack.activeServices}</TableCell> : null}
                  {visibleColumns.Deployments ? <TableCell>{stack.deploymentCount}</TableCell> : null}
                  {visibleColumns['Latest status'] ? (
                    <TableCell>
                      {stack.latestDeploymentStatus ? (
                        <Badge variant={toBadgeVariant(stack.latestDeploymentStatus)}>{stack.latestDeploymentStatus}</Badge>
                      ) : (
                        <Badge variant="outline">none</Badge>
                      )}
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setActionFeedback(`Restart requested for stack ${stack.name}.`)}>
                        Restart
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setActionFeedback(`Stop requested for stack ${stack.name}.`)}>
                        Stop
                      </Button>
                      <DockerStackDetailModalTrigger id={stack.id} className="inline-flex h-7 items-center rounded border border-border/60 px-2 text-[11px] hover:bg-muted hover:no-underline">
                        Inspect
                      </DockerStackDetailModalTrigger>
                    </div>
                  </TableCell>
                </TableRow>
                <DockerExpandedTableRow expanded={isExpanded} colSpan={totalTableColumns}>
                      <div className="rounded-lg border border-border/60 bg-background/60 p-3 text-xs">
                        <div className="mb-3 grid gap-2 md:grid-cols-4">
                          <div className="rounded border border-border/60 bg-muted/30 p-2">
                            <p className="text-muted-foreground">Stack ID</p>
                            <code className="font-mono break-all">{stack.id}</code>
                          </div>
                          <div className="rounded border border-border/60 bg-muted/30 p-2">
                            <p className="text-muted-foreground">Project</p>
                            <code className="font-mono break-all">{stack.projectId}</code>
                          </div>
                          <div className="rounded border border-border/60 bg-muted/30 p-2">
                            <p className="text-muted-foreground">Networks</p>
                            <p className="font-medium">{stackEntity?.networkIds.length ?? 0}</p>
                          </div>
                          <div className="rounded border border-border/60 bg-muted/30 p-2">
                            <p className="text-muted-foreground">Volumes</p>
                            <p className="font-medium">{stackEntity?.volumeIds.length ?? 0}</p>
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-2">
                            <p className="text-muted-foreground">Services</p>
                            <div className="max-h-44 overflow-auto rounded border border-border/60">
                              {(stackEntity?.services ?? []).map((service) => (
                                <div key={service.serviceId} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 border-b border-border/40 px-2 py-1.5 last:border-b-0">
                                  <code className="font-mono text-[11px] break-all">{service.serviceId}</code>
                                  <span>replicas {service.replicas}/{service.desiredReplicas}</span>
                                  <span className="text-muted-foreground">containers {service.containerIds.length}</span>
                                  <Badge variant="outline">{service.status}</Badge>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <p className="text-muted-foreground">Labels</p>
                            <div className="max-h-44 overflow-auto rounded border border-border/60">
                              {stackEntity && Object.entries(stackEntity.labels).length > 0 ? (
                                Object.entries(stackEntity.labels).map(([labelKey, labelValue]) => (
                                  <div key={labelKey} className="grid grid-cols-[160px_1fr] gap-2 border-b border-border/40 px-2 py-1.5 last:border-b-0">
                                    <span className="text-muted-foreground">{labelKey}</span>
                                    <code className="font-mono break-all">{labelValue}</code>
                                  </div>
                                ))
                              ) : (
                                <div className="px-2 py-1.5 text-muted-foreground">No labels</div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                </DockerExpandedTableRow>
                </Fragment>
                )
              })}
              {!isInitialLoading && filteredStacks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={totalTableColumns} className="text-center text-muted-foreground py-8">
                    No stacks detected yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          </div>

          <div className="mt-2">
            <DockerTablePagination
              page={stackTable.page}
              pageSize={stackTable.pageSize}
              totalRows={stackTable.totalRows}
              totalPages={stackTable.totalPages}
              from={stackTable.from}
              to={stackTable.to}
              onPageChange={(nextPage) => {
                setListQuery({ page: nextPage })
              }}
              onPageSizeChange={(nextPageSize) => {
                setListQuery({ pageSize: nextPageSize, page: 1 })
              }}
            />
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">
              <p className="text-muted-foreground">Visible</p>
              <p className="text-base font-semibold">{filteredStacks.length}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">
              <p className="text-muted-foreground">Selected</p>
              <p className="text-base font-semibold">{selectedIds.size}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">
              <p className="text-muted-foreground">Healthy</p>
              <p className="text-base font-semibold">{healthyStacks}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">
              <p className="text-muted-foreground">Failed</p>
              <p className="text-base font-semibold">{failedStacks}</p>
            </div>
          </div>

          <div className="mt-3">
            <DockerColumnSettings
              title="Column settings"
              columns={visibleColumns}
              onToggle={(column, visible) => {
                setVisibleColumns((previous) => ({ ...previous, [column]: visible }))
              }}
            />
          </div>
        </div>
      </section>
    </div>
  )
}
