'use client'

import { useMemo, useState } from 'react'
import { ENV_NAMES, type EnvName } from '@repo/contracts-common'
import { MOCK_DEPENDENCIES_BY_PROJECT, MOCK_SERVICE_CONFIGS_BY_PROJECT } from '@/mocks/platform'
import { useDockerContainerList } from '@/domains/docker/hooks'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'

const LIST_INPUT = {
  query: {
    limit: 300,
    offset: 0,
  },
} as const

type Density = 'default' | 'compact'

interface ServiceOpsOverviewCardsProps {
  projectId: string
  serviceId: string
  density?: Density
}

function toBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const normalized = status.toLowerCase()
  if (normalized === 'success' || normalized === 'active' || normalized === 'healthy' || normalized === 'passing') return 'default'
  if (normalized === 'failed' || normalized === 'error' || normalized === 'down' || normalized === 'failing') return 'destructive'
  if (normalized === 'pending' || normalized === 'queued' || normalized === 'building' || normalized === 'degraded' || normalized === 'warning') {
    return 'secondary'
  }
  return 'outline'
}

export function ServiceOpsOverviewCards({ projectId, serviceId, density = 'default' }: ServiceOpsOverviewCardsProps) {
  const serviceConfig = useMemo(() => (MOCK_SERVICE_CONFIGS_BY_PROJECT[projectId] ?? {})[serviceId] ?? null, [projectId, serviceId])
  const dependencies = useMemo(() => MOCK_DEPENDENCIES_BY_PROJECT[projectId] ?? [], [projectId])
  const outgoingDependencies = useMemo(
    () => dependencies.filter((dependency) => dependency.serviceId === serviceId),
    [dependencies, serviceId],
  )
  const incomingDependencies = useMemo(
    () => dependencies.filter((dependency) => dependency.dependsOnServiceId === serviceId),
    [dependencies, serviceId],
  )
  const availableEnvironments = useMemo(() => {
    if (!serviceConfig) {
      return [...ENV_NAMES]
    }

    const set = new Set<EnvName>([
      'production',
      ...(Object.keys(serviceConfig.statusByEnvironment) as EnvName[]),
      ...(Object.keys(serviceConfig.executionOverrides) as EnvName[]),
    ])

    return ENV_NAMES.filter((env) => set.has(env))
  }, [serviceConfig])

  const [environment, setEnvironment] = useState<EnvName>('production')

  const { data: containerData } = useDockerContainerList(LIST_INPUT)
  const replicas = useMemo(() => {
    return (containerData?.data ?? [])
      .filter((container) => container.projectId === projectId && container.serviceId === serviceId)
      .sort((left, right) => left.name.localeCompare(right.name))
  }, [containerData?.data, projectId, serviceId])

  if (!serviceConfig) {
    return null
  }

  const safeEnvironment = availableEnvironments.includes(environment) ? environment : availableEnvironments[0] ?? 'production'
  const envOverride = serviceConfig.executionOverrides[safeEnvironment]
  const runtime = serviceConfig.statusByEnvironment[safeEnvironment] ?? serviceConfig.statusByEnvironment.production
  const enabledOutgoingDependencies = outgoingDependencies.filter(
    (dependency) => !dependency.enabledIn || dependency.enabledIn.length === 0 || dependency.enabledIn.includes(safeEnvironment),
  )
  const healthyReplicas = replicas.filter((replica) => ['healthy', 'passing', 'active', 'running'].includes(replica.health.toLowerCase()))

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
          <CardHeader className="pb-2">
            <CardDescription>Swarm / orchestrator profile</CardDescription>
            <CardTitle className="text-base capitalize">{serviceConfig.runnerType.replace('-', ' ')}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-xs text-muted-foreground">
            Strategy {envOverride?.strategy ?? serviceConfig.runnerConfig.strategy}
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
          <CardHeader className="pb-2">
            <CardDescription>Replica envelope</CardDescription>
            <CardTitle className="text-base">
              {(envOverride?.replicas?.min ?? serviceConfig.minReplicas)} → {(envOverride?.replicas?.max ?? serviceConfig.maxReplicas)}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-xs text-muted-foreground">
            {replicas.length} running replicas · {healthyReplicas.length} healthy
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
          <CardHeader className="pb-2">
            <CardDescription>Dependency fan-out</CardDescription>
            <CardTitle className="text-base">{enabledOutgoingDependencies.length}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-xs text-muted-foreground">
            {outgoingDependencies.length} total outgoing · {incomingDependencies.length} incoming
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
          <CardHeader className="pb-2">
            <CardDescription>Environment state</CardDescription>
            <CardTitle className="text-base capitalize">{runtime.health}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-xs text-muted-foreground">
            {safeEnvironment} · {runtime.lifecycle}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/60 bg-card/35 backdrop-blur-xl">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Runtime scope details</CardTitle>
              <CardDescription>Every tab keeps env/dependency/replica context in sync.</CardDescription>
            </div>
            <Select value={safeEnvironment} onValueChange={(value) => setEnvironment(value as EnvName)}>
              <SelectTrigger className="h-8 w-[180px]">
                <SelectValue placeholder="Environment" />
              </SelectTrigger>
              <SelectContent>
                {availableEnvironments.map((env) => (
                  <SelectItem key={env} value={env}>
                    {env}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent className={density === 'compact' ? 'space-y-2' : 'space-y-3'}>
          <div className="flex flex-wrap gap-2">
            <Badge variant={envOverride?.disabled ? 'outline' : 'default'}>{envOverride?.disabled ? 'disabled in env' : 'enabled in env'}</Badge>
            <Badge variant="outline">autoscale {serviceConfig.autoscaleEnabled ? 'on' : 'off'}</Badge>
            <Badge variant="outline">pinned {serviceConfig.pinnedEnvironment}</Badge>
            <Badge variant={toBadgeVariant(runtime.health)}>{runtime.health}</Badge>
            <Badge variant="outline">deps enabled {enabledOutgoingDependencies.length}</Badge>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Replica</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Health</TableHead>
                <TableHead>Dependency mode</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {replicas.slice(0, density === 'compact' ? 4 : 8).map((replica) => (
                <TableRow key={replica.id}>
                  <TableCell className="font-mono text-xs">{replica.name}</TableCell>
                  <TableCell><Badge variant={toBadgeVariant(replica.status)}>{replica.status}</Badge></TableCell>
                  <TableCell><Badge variant={toBadgeVariant(replica.health)}>{replica.health}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {envOverride?.dependencyLinkPolicy?.target?.mode ?? 'same-environment'}
                  </TableCell>
                </TableRow>
              ))}
              {replicas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-xs text-muted-foreground">
                    No live replicas detected for this service in docker mock state.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
