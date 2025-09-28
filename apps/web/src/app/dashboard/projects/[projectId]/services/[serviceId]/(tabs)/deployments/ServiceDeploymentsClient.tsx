'use client'

import { useDeployments, useDeploymentActions } from '@/hooks/useDeployments'
import { Card, CardContent } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Container, Zap, Loader2 } from 'lucide-react'
import DeploymentCard from '@/components/deployments/DeploymentCard'
import { useParams } from '@/routes/hooks'
import { DashboardProjectsProjectIdServicesServiceIdTabsDeployments } from '@/routes/index'

export default function ServiceDeploymentsClient() {
  const params = useParams(
    DashboardProjectsProjectIdServicesServiceIdTabsDeployments
  )
  const { data: deploymentsData, isLoading } = useDeployments({
    serviceId: params.serviceId,
  })
  const deployments = deploymentsData?.deployments || []
  const { triggerDeployment, isLoading: deploymentLoading } =
    useDeploymentActions()

  const handleTriggerDeployment = async () => {
    try {
      await triggerDeployment({
        serviceId: params.serviceId,
        environment: 'production',
        // Let the API determine sourceType and sourceConfig from the service's database configuration
        // No need to specify these - they should come from the service's provider/builder settings
      })
    } catch (error) {
      console.error('Failed to trigger deployment:', error)
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading deployments...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Deployment History</h3>
          <p className="text-sm text-muted-foreground">
            View and manage all deployments for this service
          </p>
        </div>
        <Button
          onClick={handleTriggerDeployment}
          disabled={deploymentLoading.trigger}
        >
          {deploymentLoading.trigger ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Deploying...
            </>
          ) : (
            <>
              <Zap className="h-4 w-4 mr-2" />
              New Deployment
            </>
          )}
        </Button>
      </div>

      {/* Deployment List */}
      <div className="space-y-4">
        {deployments.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <Container className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">No deployments yet</h3>
                <p className="text-muted-foreground mb-6">
                  Deploy this service to see deployment history here
                </p>
                <Button
                  onClick={handleTriggerDeployment}
                  disabled={deploymentLoading.trigger}
                >
                  {deploymentLoading.trigger ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Deploying...
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4 mr-2" />
                      Deploy Now
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {deployments.map((deployment, idx) => (
              <DeploymentCard
                key={deployment.id}
                deployment={deployment}
                projectId={params.projectId}
                serviceId={params.serviceId}
                // Choose a sensible default rollback target: the latest successful deployment before this one
                rollbackTargetId={(() => {
                  const prev = deployments
                    .slice(0, idx)
                    .reverse()
                    .find((d) => d.status === 'success')
                  return prev?.id
                })()}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
