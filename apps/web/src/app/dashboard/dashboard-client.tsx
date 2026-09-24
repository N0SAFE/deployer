'use client'

import { useMemo } from 'react'
import { AuthDashboardDeployments } from '@/routes'
import { useDeploymentList } from '@/domains/deployment/hooks'
import { useClusterSnapshot } from '@/domains/cluster/hooks'
import { useRealTimeMetrics } from '@/domains/analytics/hooks'
import { MeshPulse } from '@/components/dashboard/MeshPulse'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import {
  StatusBadge,
  StatusDot,
  StatStrip,
  StatStripItem,
  statusToneFrom,
  EnvironmentBadge,
  type StatusTone,
} from '@/components/dashboard'
import {
  ArrowRight,
  CheckCircle2,
  Cpu,
  HardDrive,
  Network,
  Rocket,
  Server,
  ShieldCheck,
} from 'lucide-react'

/**
 * Above this, resource pressure starts delaying scheduling — the threshold at
 * which a number stops being context and becomes something to act on.
 */
const RESOURCE_PRESSURE_PERCENT = 80

function relativeTime(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return '—'
  const seconds = Math.round((Date.now() - parsed.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${String(minutes)}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)}h ago`
  const days = Math.floor(hours / 24)
  return `${String(days)}d ago`
}

interface DeploymentLike {
  id?: string
  serviceId?: string
  status?: string
  environment?: string
  createdAt?: string
}

function projectLabel(serviceId: string): string {
  return serviceId.replace(/-/g, ' ').slice(0, 22)
}

/**
 * Context-strip formatters. Each returns `undefined` when the reading is not
 * known yet, which `StatStripItem` renders as an em dash: "not measured" and
 * "measured as zero" are different facts, and conflating them is how a
 * dashboard starts lying during startup.
 */
function formatPercent(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${value.toFixed(0)}%`
}

function formatMegabytes(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${(value / 1024 / 1024).toFixed(1)} MB`
}

function pressureTone(value: number | undefined): StatusTone | undefined {
  return value !== undefined && value > RESOURCE_PRESSURE_PERCENT ? 'pending' : undefined
}

/**
 * Command center — the operator's landing surface.
 *
 * Composition:
 *  1. Needs attention (the decision)  │  Recent deployments (the timeline)
 *  2. Context strip (scale, as one dense row)
 *
 * The role and permission level are deliberately absent: they are readable on
 * the account menu and the profile page, and neither changes what an operator
 * does next, so they were occupying the most valuable space on the page.
 */
export function DashboardOverviewClient() {
  const { data: snapshot } = useClusterSnapshot()
  const { data: realtimeMetrics } = useRealTimeMetrics()

  const { data: deploymentsData, isLoading: deploymentsLoading } = useDeploymentList({ query: { limit: 8, offset: 0 } })

  const recentDeployments = useMemo<DeploymentLike[]>(() => {
    const raw = (deploymentsData as { data?: unknown[] } | undefined)?.data ?? []
    return (raw as DeploymentLike[])
      .filter((d) => d.createdAt)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 6)
  }, [deploymentsData])

  /**
   * The decision this page exists to support: "what needs me right now?"
   *
   * Derived, not decorative — an entry appears only when something is BOTH
   * wrong AND actionable by the person reading it. The former top strip showed
   * "Your role / CPU / Memory / Network" because those were the available
   * numbers, not because they answered this question; the result was a screen
   * where, in the words of the dashboard-UX literature, "every number is
   * present, none of them pointed anywhere".
   *
   * An empty list is a real, useful answer ("nothing needs you"), which is why
   * it renders as one calm line instead of being padded out with metrics.
   */
  const attentionItems = useMemo(() => {
    const items: { key: string; label: string; detail: string; tone: StatusTone }[] = []

    // Control plane — the platform cannot schedule anything without it.
    if (snapshot !== undefined) {
      if (snapshot.localNodeState !== 'active') {
        items.push({
          key: 'cluster-state',
          label: 'Cluster is not active',
          detail: `This node is ${snapshot.localNodeState} — workloads cannot be scheduled`,
          tone: 'danger',
        })
      } else if (!snapshot.controlAvailable) {
        items.push({
          key: 'cluster-control',
          label: 'Control plane unreachable',
          detail: 'No swarm manager is answering on this mesh',
          tone: 'danger',
        })
      }
    }

    // Rollouts that failed or are still in flight.
    for (const dep of recentDeployments) {
      const tone = statusToneFrom(dep.status)
      if (tone !== 'danger' && tone !== 'pending') continue
      items.push({
        key: `dep-${dep.id ?? dep.serviceId ?? 'unknown'}`,
        label: projectLabel(dep.serviceId ?? dep.id ?? ''),
        detail: tone === 'danger' ? 'Deployment failed — open it for the failing step' : 'Deployment still in progress',
        tone,
      })
    }

    // Resource pressure that will start affecting scheduling.
    const cpu = realtimeMetrics?.system.cpu
    if (cpu !== undefined && cpu > RESOURCE_PRESSURE_PERCENT) {
      items.push({ key: 'cpu', label: 'CPU pressure', detail: `${cpu.toFixed(0)}% of host CPU in use`, tone: 'pending' })
    }
    const memory = realtimeMetrics?.system.memory
    if (memory !== undefined && memory > RESOURCE_PRESSURE_PERCENT) {
      items.push({ key: 'memory', label: 'Memory pressure', detail: `${memory.toFixed(0)}% of host memory in use`, tone: 'pending' })
    }

    return items
  }, [snapshot, recentDeployments, realtimeMetrics])

  return (
    <>
      {/* ── Signature: the live fleet spine ── */}
      <MeshPulse className="mb-3" />

      {/* ── The decision + the timeline ── */}
      <div className="grid gap-3 lg:grid-cols-5">
        {/* Needs attention — the ONE thing that should change after reading this */}
        <Card className="border-border/60 bg-card/40 backdrop-blur-xl lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm">Needs attention</CardTitle>
              <StatusBadge
                status={attentionItems.length === 0 ? 'healthy' : 'degraded'}
                pulse={attentionItems.some((item) => item.tone === 'pending')}
              />
            </div>
            <CardDescription className="text-xs">
              {attentionItems.length === 0
                ? 'Nothing is waiting on you'
                : `${String(attentionItems.length)} thing${attentionItems.length === 1 ? '' : 's'} to look at`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {attentionItems.length === 0 ? (
              <div className="flex items-center gap-2.5 rounded-lg bg-status-live/5 px-3 py-3 ring-1 ring-status-live/20">
                <CheckCircle2 className="size-4 shrink-0 text-status-live" />
                <p className="text-sm text-muted-foreground">
                  Every node, rollout and resource is healthy.
                </p>
              </div>
            ) : (
              <ul className="space-y-1">
                {attentionItems.map((item) => (
                  <li key={item.key}>
                    <div className="flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-background/50">
                      <StatusDot tone={item.tone} pulse={item.tone === 'pending'} className="mt-1.5" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{item.label}</p>
                        <p className="text-xs text-muted-foreground">{item.detail}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Recent deployments — the timeline */}
        <Card className="border-border/60 bg-card/40 backdrop-blur-xl lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
            <div>
              <CardTitle className="text-sm">Recent deployments</CardTitle>
              <CardDescription className="text-xs">Latest rollouts across environments</CardDescription>
            </div>
            <AuthDashboardDeployments.Link>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]">
                View all
                <ArrowRight className="ml-1 size-3" />
              </Button>
            </AuthDashboardDeployments.Link>
          </CardHeader>
          <CardContent>
            {deploymentsLoading ? (
              <div className="space-y-1.5">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-10 animate-pulse rounded-lg bg-muted/40" />
                ))}
              </div>
            ) : recentDeployments.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-1 py-10 text-center">
                <Rocket className="size-8 text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground">No deployments yet</p>
                <p className="text-xs text-muted-foreground">Rollouts appear here once you deploy a service.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {recentDeployments.map((dep) => {
                  const status = dep.status ?? 'unknown'
                  const tone = statusToneFrom(status)
                  return (
                    <AuthDashboardDeployments.Link key={dep.id} className="group block">
                      <div className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors group-hover:bg-background/50">
                        <StatusDot tone={tone} pulse={tone === 'pending'} />
                        <p className="min-w-0 flex-1 truncate text-sm font-medium">
                          {projectLabel(dep.serviceId ?? dep.id ?? '')}
                        </p>
                        <EnvironmentBadge environment={dep.environment} className="hidden sm:inline-flex" />
                        <StatusBadge status={status} className="shrink-0" />
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {relativeTime(dep.createdAt ?? '')}
                        </span>
                      </div>
                    </AuthDashboardDeployments.Link>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/*
        ── Context strip ────────────────────────────────────────────────────
        The numbers that give the two panels above their scale. `StatStrip`
        exists for exactly this shape: a label and a value on one line, no card
        chrome, wrapping rather than stacking on narrow viewports.
      */}
      <StatStrip>
        <StatStripItem icon={Server} label="Nodes" value={snapshot?.nodeCount} />
        <StatStripItem icon={ShieldCheck} label="Managers" value={snapshot?.managerCount} />
        <StatStripItem
          icon={Cpu}
          label="CPU"
          value={formatPercent(realtimeMetrics?.system.cpu)}
          tone={pressureTone(realtimeMetrics?.system.cpu)}
        />
        <StatStripItem
          icon={HardDrive}
          label="Memory"
          value={formatPercent(realtimeMetrics?.system.memory)}
          tone={pressureTone(realtimeMetrics?.system.memory)}
        />
        <StatStripItem
          icon={Network}
          label="Inbound"
          value={formatMegabytes(realtimeMetrics?.system.network.inbound)}
        />
      </StatStrip>
    </>
  )
}
