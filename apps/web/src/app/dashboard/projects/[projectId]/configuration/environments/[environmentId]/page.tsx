'use client'

import { useParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { PageSkeleton, StatusBadge } from '@/components/dashboard'
import { useProject, useProjectEnvironment } from '@/domains/project/hooks'
import { AuthDashboardProjectsProjectIdConfiguration, AuthDashboardProjectsProjectIdEnvironments } from '@/routes'
import { IdChip } from '../../../../_components/workload/CopyButton'
import { RelativeTime } from '../../../../_components/workload/RelativeTime'
import { InlineError } from '../../../../_components/workload/WorkloadStates'

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="mb-1 text-sm font-medium">{label}</dt>
      <dd className="text-sm text-muted-foreground">{children}</dd>
    </div>
  )
}

/** Read-only detail of one environment: identity, status and its rules. Edit it from the Environments page. */
export default function DashboardProjectEnvironmentPage() {
  const { projectId, environmentId } = useParams<{ projectId: string; environmentId: string }>()

  const projectQuery = useProject(projectId)
  const envQuery = useProjectEnvironment(projectId, environmentId)
  const env = envQuery.data

  if (projectQuery.isLoading || envQuery.isLoading) return <PageSkeleton blocks={2} withStrip={false} label="Loading environment" />

  const error = projectQuery.error ?? envQuery.error
  if (error) {
    return (
      <InlineError
        title="Could not load the environment"
        error={error}
        onRetry={() => { void projectQuery.refetch(); void envQuery.refetch() }}
        action={
          <AuthDashboardProjectsProjectIdConfiguration.Link projectId={projectId}>
            <Button variant="outline" size="sm">Back to configuration</Button>
          </AuthDashboardProjectsProjectIdConfiguration.Link>
        }
      />
    )
  }
  if (!env) {
    return <InlineError title="Environment not found" error={new Error('This environment does not exist or was deleted.')} />
  }

  return (
    <div className="space-y-6">
      <AuthDashboardProjectsProjectIdConfiguration.Link projectId={projectId}>
        <Button variant="ghost" size="sm"><ArrowLeft className="mr-2 size-4" />Back to configuration</Button>
      </AuthDashboardProjectsProjectIdConfiguration.Link>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle>Environment: {env.name}</CardTitle>
            <Badge variant="outline">{env.kind}</Badge>
            <StatusBadge status={env.status} />
          </div>
          <CardDescription>
            {env.description ?? 'No description.'} To rename, clone or delete it, use{' '}
            <AuthDashboardProjectsProjectIdEnvironments.Link projectId={projectId} className="underline underline-offset-2">
              the project Environments page
            </AuthDashboardProjectsProjectIdEnvironments.Link>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Fact label="Environment ID"><IdChip id={env.id} label="Copy environment ID" chars={36} /></Fact>
            <Fact label="Project">{projectQuery.data?.name ?? '—'}</Fact>
            <Fact label="Slug"><code className="font-mono">{env.slug}</code></Fact>
            <Fact label="Legacy type">{env.type ?? 'custom (none)'}</Fact>
            <Fact label="Active">{env.isActive ? 'Yes' : 'No — deployments to it are paused'}</Fact>
            <Fact label="Last updated"><RelativeTime value={env.updatedAt} /></Fact>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rules</CardTitle>
          <CardDescription>How deployments behave in this environment.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Fact label="Auto-deploy">{env.rules.autoDeployEnabled ? 'Enabled' : 'Disabled'}</Fact>
            <Fact label="Strategy">{env.rules.deploymentStrategy}</Fact>
            <Fact label="Health gate">{env.rules.healthGate}</Fact>
            <Fact label="Startup mode">{env.rules.startupMode}</Fact>
            <Fact label="Replicas">{String(env.rules.replicas.min)} – {String(env.rules.replicas.max)}</Fact>
            <Fact label="Max error rate / latency">{String(env.rules.trafficPolicy.maxErrorRatePercent)}% / {String(env.rules.trafficPolicy.maxLatencyMs)} ms</Fact>
          </dl>
        </CardContent>
      </Card>
    </div>
  )
}
