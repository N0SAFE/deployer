'use client'

import { isDefinedORPCError, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { ENV_NAMES, type EnvName } from '@repo/contracts-common'
import { useProject, useProjectEnvironment } from '@/domains/project/hooks'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Siren, ArrowLeft } from 'lucide-react'
import { AuthDashboardProjectsProjectIdConfiguration } from '@/routes'
import { formatDate, shortId } from '../../../_utils/helpers'

export default function DashboardProjectEnvironmentPage() {
  const params = useParams<{ projectId: string; environmentId: string }>()
  const projectId = params.projectId
  const environmentId = params.environmentId

  const { data: projectData, isLoading: projectLoading, error: projectError } = useProject(projectId)
  const { data: environmentData, isLoading: envLoading, error: envError } = useProjectEnvironment(projectId, environmentId)

  const isKnownEnv = ENV_NAMES?.includes(environmentId as EnvName)
  const envName = environmentData?.name ?? environmentId

  if (projectLoading || envLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    )
  }

  if (projectError || envError) {
    return (
      <Alert variant="destructive">
        <Siren className="size-4" />
        <AlertTitle>Failed to load environment</AlertTitle>
        <AlertDescription>
          {(() => {
            const err = projectError ?? envError
            return isDefinedORPCError(err) ? getErrorMessage(err, 'An unexpected error occurred.') : 'An unexpected error occurred.'
          })()}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      {/* Back button */}
      <AuthDashboardProjectsProjectIdConfiguration.Link projectId={projectId}>
        <Button variant="ghost" size="sm">
          <ArrowLeft className="mr-2 size-4" />
          Back to Configuration
        </Button>
      </AuthDashboardProjectsProjectIdConfiguration.Link>

      {/* Environment detail */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <CardTitle>Environment: {envName}</CardTitle>
            {isKnownEnv && <Badge>Standard</Badge>}
          </div>
          <CardDescription>
            Configuration details for the <strong>{environmentId}</strong> environment.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Environment ID</Label>
              <p className="text-sm text-muted-foreground font-mono">{shortId(environmentId)}</p>
            </div>
            <div>
              <Label>Project</Label>
              <p className="text-sm text-muted-foreground">{projectData?.name ?? 'Unknown'}</p>
            </div>
            <div>
              <Label>Type</Label>
              <p className="text-sm text-muted-foreground">
                {environmentData?.type ?? isKnownEnv ? 'standard' : 'custom'}
              </p>
            </div>
            <div>
              <Label>Status</Label>
              <p className="text-sm text-muted-foreground">
                  <Badge variant={environmentData?.status === 'healthy' ? 'default' : 'secondary'}>
                  {environmentData?.status ?? 'unknown'}
                </Badge>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Environment details from API */}
      {environmentData && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Environment Properties</CardTitle>
            <CardDescription>Raw properties returned by the API.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-muted p-4 rounded-lg overflow-auto max-h-96">
              {JSON.stringify(environmentData, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-medium mb-1">{children}</p>
}
