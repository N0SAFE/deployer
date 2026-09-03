'use client'

import { useMemo } from 'react'
import {
  AuthDashboardAdminSystem,
  AuthDashboardAdminUsers,
  AuthDashboardProjects,
  AuthDashboardDeployments,
} from '@/routes'
import { useDeploymentList } from '@/domains/deployment/hooks'
import { useDockerRuntimeSseState } from '@/domains/docker/hooks'
import { useRealTimeMetrics } from '@/domains/analytics/hooks'
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
  StatusMetric,
  statusToneFrom,
  EnvironmentBadge,
} from '@/components/dashboard'
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Cpu,
  FolderKanban,
  HardDrive,
  Mail,
  Network,
  Rocket,
  ServerCog,
  Settings,
  UserCircle2,
  Users,
  XCircle,
} from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'

interface DashboardOverviewClientProps {
  isAdmin: boolean
  userRole: string
}

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
 * Command center — the bento overview.
 *
 * Composition (section-first, per web AGENTS.md — no 4-up KPI strip):
 *  1. At a glance (live metrics + runtime stream)  │  Recent deployments (timeline)
 *  2. Quick actions
 *  3. Admin tools
 */
export function DashboardOverviewClient({ isAdmin, userRole }: DashboardOverviewClientProps) {
  const { status: runtimeStatus } = useDockerRuntimeSseState()
  const { data: realtimeMetrics } = useRealTimeMetrics()

  const { data: deploymentsData, isLoading: deploymentsLoading } = useDeploymentList({ query: { limit: 8, offset: 0 } })

  const recentDeployments = useMemo<DeploymentLike[]>(() => {
    const raw = (deploymentsData as { data?: unknown[] } | undefined)?.data ?? []
    return (raw as DeploymentLike[])
      .filter((d) => d.createdAt)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 6)
  }, [deploymentsData])

  const quickActions = [
    { link: AuthDashboardProjects.Link, icon: FolderKanban, title: 'Projects', description: 'Manage services & infrastructure' },
    { link: AuthDashboardDeployments.Link, icon: Rocket, title: 'Deployments', description: 'Timeline of recent rollouts' },
    { link: AuthDashboardAdminSystem.Link, icon: ServerCog, title: 'Control plane', description: 'Fleet & runtime health' },
  ] as const

  return (
    <>
      {/* ── Bento row 1: at a glance + system health + recent deployments ── */}
      <div className="grid gap-3 lg:grid-cols-4">
        {/* At a glance */}
        <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm">At a glance</CardTitle>
              <StatusBadge status={runtimeStatus === 'connected' ? 'live' : runtimeStatus} pulse={runtimeStatus === 'connecting'} />
            </div>
            <CardDescription className="text-xs">Your platform state right now</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <StatusMetric
              label="Your role"
              value={<span className="capitalize">{userRole}</span>}
              icon={UserCircle2}
              hint="Platform permission level"
              tone="neutral"
            />
          </CardContent>
        </Card>

        {/* System health — live from analytics */}
        <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">System Health</CardTitle>
            <CardDescription className="text-xs">Live from Docker</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <StatusMetric
              label="CPU"
              value={realtimeMetrics?.system.cpu != null ? `${realtimeMetrics.system.cpu.toFixed(1)}%` : '—'}
              icon={Cpu}
              hint={`${realtimeMetrics?.services?.length ?? 0} services`}
              tone={realtimeMetrics && realtimeMetrics.system.cpu > 80 ? 'danger' : realtimeMetrics?.system.cpu != null ? 'live' : 'neutral'}
            />
            <StatusMetric
              label="Memory"
              value={realtimeMetrics?.system.memory != null ? `${realtimeMetrics.system.memory.toFixed(1)}%` : '—'}
              icon={HardDrive}
              hint="Used"
              tone={realtimeMetrics && realtimeMetrics.system.memory > 80 ? 'danger' : realtimeMetrics?.system.memory != null ? 'live' : 'neutral'}
            />
            <StatusMetric
              label="Network"
              value={realtimeMetrics?.system.network.inbound != null ? `${(realtimeMetrics.system.network.inbound / 1024 / 1024).toFixed(1)} MB` : '—'}
              icon={Network}
              hint="Inbound"
              tone="neutral"
            />
          </CardContent>
        </Card>

        {/* Recent deployments — the timeline */}
        <Card className="border-border/60 bg-card/40 backdrop-blur-xl lg:col-span-2">
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

      {/* ── Quick actions ─────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {quickActions.map(({ link: Link, icon: Icon, title, description }) => (
          <Card key={title} className="border-border/60 bg-card/40 backdrop-blur-xl transition-all hover:border-primary/40 hover:bg-card/60">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-xs text-muted-foreground">{description}</p>
              <Link className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                Open
                <ArrowRight className="size-3" />
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Admin-only actions */}
      {isAdmin && (
        <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Administration</CardTitle>
            <CardDescription className="text-xs">Platform-wide management tools</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <AuthDashboardAdminUsers.Link>
                  <Users className="mr-1.5 size-3.5" />
                  Manage Users
                </AuthDashboardAdminUsers.Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <AuthDashboardAdminSystem.Link>
                  <Settings className="mr-1.5 size-3.5" />
                  System Dashboard
                </AuthDashboardAdminSystem.Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  )
}
