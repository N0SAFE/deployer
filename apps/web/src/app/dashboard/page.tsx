'use client'

import React from 'react'
import type { JSX } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/shadcn/table'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { useDeployments } from '@/hooks/useDeployments'
import { useProjects } from '@/hooks/useProjects'
import { useSystemHealthOverview } from '@/hooks/useHealth'
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Database,
  Gauge,
  Loader2,
  RefreshCcw,
  Rocket,
  Server,
} from 'lucide-react'

const statusClassMap: Record<string, string> = {
  success: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
  deploying: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
  building: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100',
  cancelled: 'bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-100',
}

function formatRelativeTime(value?: string | number | Date): string {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'

  const diff = Date.now() - date.getTime()
  const minutes = Math.max(0, Math.round(diff / 60000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${String(minutes)}m ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${String(hours)}h ago`

  const days = Math.round(hours / 24)
  return `${String(days)}d ago`
}

function StatCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string
  value: string | number
  description: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="text-muted-foreground h-5 w-5" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-muted-foreground text-sm">{description}</p>
      </CardContent>
    </Card>
  )
}

export default function DashboardPage(): JSX.Element {
  const deployments = useDeployments({ limit: 6 })
  const projects = useProjects({ limit: 4 })
  const health = useSystemHealthOverview()

  const deploymentsData = deployments.data?.deployments ?? []
  const projectsData = projects.data?.projects ?? []

  const totalDeployments = deployments.data?.total ?? deploymentsData.length
  const activeDeployments = deploymentsData.filter((d) =>
    ['deploying', 'building'].includes(d.status)
  ).length
  const failedDeployments = deploymentsData.filter((d) => d.status === 'failed')
    .length
  const totalProjects = projects.data?.total ?? projectsData.length
  const totalServices = projectsData.reduce(
    (sum, project) => sum + (project._count.services),
    0
  )

  const isLoading = deployments.isLoading || projects.isLoading

  return (
    <div className="container mx-auto space-y-8 px-4 py-8">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">Deployment Dashboard</h1>
          <p className="text-muted-foreground">
            Monitor projects, deployments, and platform health with live or mock data.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void Promise.all([deployments.refetch(), projects.refetch(), health.refetch()])
            }}
            disabled={deployments.isFetching || projects.isFetching}
          >
            {(deployments.isFetching || projects.isFetching) && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Refresh data
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Projects"
          value={isLoading ? '—' : totalProjects}
          description="Total tracked projects"
          icon={Cloud}
        />
        <StatCard
          title="Services"
          value={isLoading ? '—' : totalServices}
          description="Across all projects"
          icon={Server}
        />
        <StatCard
          title="Deployments"
          value={isLoading ? '—' : totalDeployments}
          description="Recent deployments"
          icon={Rocket}
        />
        <StatCard
          title="Active"
          value={isLoading ? '—' : activeDeployments}
          description="Deploying or building"
          icon={Gauge}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle>Recent deployments</CardTitle>
              <CardDescription>Latest activity across environments</CardDescription>
            </div>
            {deployments.isFetching && (
              <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
            )}
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <Skeleton key={idx} className="h-10 w-full" />
                ))}
              </div>
            ) : deploymentsData.length === 0 ? (
              <p className="text-muted-foreground text-sm">No deployments yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Service</TableHead>
                      <TableHead>Environment</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>When</TableHead>
                      <TableHead>By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deploymentsData.map((deployment) => (
                      <TableRow key={deployment.deploymentId}>
                        <TableCell className="font-medium">
                          {deployment.serviceId}
                        </TableCell>
                        <TableCell className="capitalize">
                          {deployment.environment}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={statusClassMap[deployment.status] ?? ''}
                          >
                            {deployment.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="capitalize">
                          {deployment.sourceType}
                        </TableCell>
                        <TableCell>
                          {formatRelativeTime(deployment.createdAt)}
                        </TableCell>
                        <TableCell>{deployment.deployedBy}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-2">
            <CardTitle className="flex items-center gap-2">
              {health.basic.status === 'healthy' ? (
                <CheckCircle2 className="text-green-500 h-5 w-5" />
              ) : (
                <AlertTriangle className="text-amber-500 h-5 w-5" />
              )}
              System health
            </CardTitle>
            <CardDescription>
              Overview of API uptime and database connectivity
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-sm">Status</span>
              <Badge
                variant="outline"
                className={
                  health.basic.status === 'healthy'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
                    : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
                }
              >
                {health.basic.status}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-sm">Uptime</span>
              <span className="font-medium">
                {health.detailed.uptime
                  ? `${String(Math.round(health.detailed.uptime / 3600))}h`
                  : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-sm">Database</span>
              <div className="flex items-center gap-2">
                <Database className="text-muted-foreground h-4 w-4" />
                <span className="font-medium">
                  {health.detailed.database.status}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-sm">Memory used</span>
              <span className="font-medium">
                {health.detailed.memory.used
                  ? `${String(Math.round(
                      (health.detailed.memory.used / 1024 / 1024) * 10
                    ) / 10)} MB`
                  : '—'}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => void health.refetch()}
            >
              <RefreshCcw className="mr-2 h-4 w-4" />Refresh health
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle>Projects</CardTitle>
            <CardDescription>Recently updated projects</CardDescription>
          </div>
          {projects.isFetching && (
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          )}
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, idx) => (
              <Skeleton key={idx} className="h-28 w-full" />
            ))
          ) : projectsData.length === 0 ? (
            <p className="text-muted-foreground text-sm">No projects available.</p>
          ) : (
            projectsData.map((project) => (
              <Card key={project.id} className="border-primary/10">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">{project.name}</CardTitle>
                    <Badge variant="outline" className="capitalize">
                      {project.latestDeployment?.status ?? 'unknown'}
                    </Badge>
                  </div>
                  <CardDescription className="line-clamp-2">
                    {project.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Services</span>
                    <span className="font-medium">
                      {project._count.services}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Deployments</span>
                    <span className="font-medium">
                      {project._count.deployments}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Updated</span>
                    <span className="font-medium">
                      {formatRelativeTime(project.updatedAt)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
