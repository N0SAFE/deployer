'use client'

import { AuthDashboardProjects } from '@/routes'
import { useMemo, useState } from 'react'
import { useServiceList } from '@/domains/service/hooks'
import { useDeploymentList } from '@/domains/deployment/hooks'
import { isTopLevelService } from '@/domains/service/hierarchy'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { ArrowRight, RefreshCw, Server, Search, Siren, GitBranch, CheckCircle2, Clock, XCircle } from 'lucide-react'
import { PageHeader, PageLoadingState, PageErrorState, StatusDot, ScopeLabel } from '@/components/dashboard'

/** One cell of the compact service summary band. */
function ServiceBandCell({
  label,
  value,
  tone,
}: {
  label: string
  value: React.ReactNode
  tone: 'live' | 'pending' | 'danger' | 'neutral'
}) {
  return (
    <div className="flex flex-1 items-center gap-3 px-4 py-3">
      <StatusDot tone={tone} />
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold tracking-tight tabular-nums">{value}</p>
      </div>
    </div>
  )
}

export default function DashboardServicesPage() {
  const [searchQuery, setSearchQuery] = useState('')

  const { data: servicesData, isLoading, error, refetch } = useServiceList({ query: { limit: 100, offset: 0 } })
  const services = useMemo(() => servicesData?.data ?? [], [servicesData])

  // Fetch recent deployments to derive per-service health
  const { data: deploymentsData } = useDeploymentList({ query: { limit: 50, offset: 0 } })
  const deployments = useMemo(() => (deploymentsData?.data ?? []) as Array<{ serviceId: string; status: string; createdAt: string }>, [deploymentsData])

  // Latest deployment per service (most recent first wins)
  const latestByService = useMemo(() => {
    const map = new Map<string, { status: string; createdAt: string }>()
    for (const d of deployments) {
      if (!d.serviceId) continue
      const existing = map.get(d.serviceId)
      if (!existing || String(d.createdAt) > String(existing.createdAt)) {
        map.set(d.serviceId, { status: d.status, createdAt: d.createdAt })
      }
    }
    return map
  }, [deployments])

  // Map sub-services to their parent so they render as nested entries.
  const parentById = useMemo(() => {
    const map = new Map<string, typeof services[number]>()
    for (const s of services) {
      const pid = s.parentId
      if (pid) {
        const parent = services.find((p) => p.id === pid)
        if (parent) map.set(s.id, parent)
      }
    }
    return map
  }, [services])

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return services.filter((row: Record<string, unknown>) => {
      if (!query) return true
      const name = ((row.name as string) ?? '').toLowerCase()
      const id = ((row.id as string) ?? '').toLowerCase()
      return name.includes(query) || id.includes(query)
    })
  }, [searchQuery, services])

  const summary = useMemo(() => {
    const total = services.length
    const active = services.filter((s: Record<string, unknown>) => s.status === 'running' || s.status === 'active').length
    const lastDeployOk = [...latestByService.values()].filter((d) => d.status === 'success').length
    const lastDeployFail = [...latestByService.values()].filter((d) => d.status === 'failed').length
    return { total, active, lastDeployOk, lastDeployFail }
  }, [services, latestByService])

  if (error) {
    return (
      <PageErrorState
        title="Failed to load services"
        message={(error as Error).message ?? 'An unexpected error occurred'}
        onRetry={() => void refetch()}
      />
    )
  }

  if (isLoading) {
    return <PageLoadingState label="Loading services…" />
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Services"
        title="Service inventory"
        description="Health and lifecycle status across all services."
        badge={<ScopeLabel scope="mesh" />}
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 size-4" />
              Refresh
            </Button>
            <Button asChild variant="outline">
              <AuthDashboardProjects.Link>
                Open projects
                <ArrowRight className="ml-2 size-4" />
              </AuthDashboardProjects.Link>
            </Button>
          </>
        }
      />

      {/* Section-first summary band (no floating KPI strip — web AGENTS.md) */}
      <div className="flex flex-wrap items-stretch divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card/40 backdrop-blur-xl sm:divide-x sm:divide-y-0">
        <ServiceBandCell label="Total" value={summary.total} tone="neutral" />
        <ServiceBandCell label="Active" value={summary.active} tone="live" />
        <ServiceBandCell
          label="Last deploy OK"
          value={summary.lastDeployOk}
          tone={summary.lastDeployOk > 0 ? 'live' : 'neutral'}
        />
        <ServiceBandCell
          label="Last deploy failed"
          value={summary.lastDeployFail}
          tone={summary.lastDeployFail > 0 ? 'danger' : 'neutral'}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All services</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(event.target.value)}
              placeholder="Search services..."
              className="pl-9"
              aria-label="Search services"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="outline"><Server className="mr-1 size-3" /> {filteredRows.length} visible</Badge>
            <Badge variant={summary.total - summary.active > 0 ? 'warning' as const : 'secondary' as const}>
              <Siren className="mr-1 size-3" /> {summary.total - summary.active} inactive
            </Badge>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Last Deploy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row: Record<string, unknown>) => {
                  const parent = parentById.get(row.id as string)
                  const topLevel = isTopLevelService(row as never)
                  const deploy = latestByService.get(row.id as string)
                  return (
                    <TableRow key={row.id as string}>
                      <TableCell>
                        <div className={topLevel ? '' : 'pl-6'}>
                          {!topLevel ? (
                            <GitBranch className="mr-2 inline size-3.5 text-muted-foreground" />
                          ) : null}
                          <span className="font-medium">{(row.name as string) ?? row.id as string}</span>
                          {!topLevel && parent ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                              sub-service of <span className="font-medium">{parent.name as string}</span>
                            </span>
                          ) : null}
                          <p className="text-xs text-muted-foreground">{row.id as string}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={(row.status as string) === 'active' || (row.status as string) === 'running' ? 'default' : 'secondary'}>
                          {(row.status as string) ?? 'unknown'}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {deploy ? (
                          <div className="flex items-center gap-1.5">
                            {deploy.status === 'success' ? (
                              <CheckCircle2 className="size-3.5 text-green-500" />
                            ) : deploy.status === 'failed' ? (
                              <XCircle className="size-3.5 text-red-500" />
                            ) : (
                              <Clock className="size-3.5 text-muted-foreground" />
                            )}
                            <span className="text-xs text-muted-foreground">{deploy.status}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
                {filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">No services match current filters.</TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
