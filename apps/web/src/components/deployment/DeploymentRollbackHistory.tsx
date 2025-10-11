'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { 
  History,
  RefreshCw,
  GitBranch,
  GitCommit,
  Calendar,
  Loader2,
  AlertCircle,
  ArrowLeftCircle,
  CheckCircle2,
  PackageOpen
} from 'lucide-react'
import { toast } from 'sonner'
import { orpc } from '@/lib/orpc'
import { formatDistanceToNow } from 'date-fns'

interface DeploymentRollbackHistoryProps {
  serviceId: string
}

export function DeploymentRollbackHistory({ serviceId }: DeploymentRollbackHistoryProps) {
  const [selectedDeployment, setSelectedDeployment] = useState<string | null>(null)

  // Fetch rollback history
  const { data: rollbackHistory, isLoading, refetch } = useQuery(orpc.deployment.getRollbackHistory.queryOptions({
    input: { serviceId },
  }))

  // Handle rollback (this would need to be implemented in the API contracts)
  const handleRollback = (deploymentId: string) => {
    setSelectedDeployment(deploymentId)
    toast.info('Rollback functionality to be implemented', {
      description: `Would rollback to deployment: ${deploymentId}`
    })
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-48">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  if (!rollbackHistory) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-48">
          <div className="text-center space-y-2">
            <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground">Failed to load rollback history</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Rollback History
            </CardTitle>
            <CardDescription>
              Available deployments for rollback (keeping {rollbackHistory.maxRetention} most recent)
            </CardDescription>
          </div>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => refetch()}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {rollbackHistory.availableDeployments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center space-y-3">
            <PackageOpen className="h-12 w-12 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium">No Deployments Available</p>
              <p className="text-sm text-muted-foreground">
                Deploy your service to see rollback history
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {rollbackHistory.availableDeployments.map((deployment: any, index: number) => {
              const isCurrent = deployment.id === rollbackHistory.currentDeploymentId
              const isSelected = deployment.id === selectedDeployment

              return (
                <div 
                  key={deployment.id}
                  className={`p-4 border rounded-lg transition-all ${
                    isCurrent 
                      ? 'border-green-200 bg-green-50' 
                      : isSelected
                      ? 'border-blue-200 bg-blue-50'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      {/* Header with version and badges */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-medium">
                          {deployment.version || 'No version'}
                        </span>
                        {isCurrent && (
                          <Badge variant="default" className="bg-green-600">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Current
                          </Badge>
                        )}
                        {index === 0 && !isCurrent && (
                          <Badge variant="secondary">Latest</Badge>
                        )}
                        <Badge variant="outline" className="text-xs">
                          #{index + 1} of {rollbackHistory.maxRetention}
                        </Badge>
                      </div>

                      {/* Deployment details */}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        {deployment.branch && (
                          <div className="flex items-center gap-1.5">
                            <GitBranch className="h-3.5 w-3.5" />
                            <span>{deployment.branch}</span>
                          </div>
                        )}
                        {deployment.commitSha && (
                          <div className="flex items-center gap-1.5">
                            <GitCommit className="h-3.5 w-3.5" />
                            <code className="text-xs">{deployment.commitSha.substring(0, 7)}</code>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5" />
                          <span>
                            {formatDistanceToNow(new Date(deployment.createdAt), { addSuffix: true })}
                          </span>
                        </div>
                      </div>

                      {/* Status */}
                      <div className="flex items-center gap-2">
                        <Badge 
                          variant={deployment.status === 'success' ? 'default' : 'secondary'}
                          className={
                            deployment.status === 'success'
                              ? 'bg-green-100 text-green-800 border-green-200'
                              : ''
                          }
                        >
                          {deployment.status}
                        </Badge>
                      </div>
                    </div>

                    {/* Rollback button */}
                    <div className="flex-shrink-0">
                      {!isCurrent && (deployment.status === 'success' || deployment.status === 'cancelled') ? (
                        <Button
                          variant={isSelected ? "default" : "outline"}
                          size="sm"
                          onClick={() => handleRollback(deployment.id)}
                          className="gap-2"
                        >
                          <ArrowLeftCircle className="h-4 w-4" />
                          Rollback
                        </Button>
                      ) : !isCurrent && deployment.status === 'failed' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled
                          className="gap-2 opacity-50 cursor-not-allowed"
                          title="Cannot rollback to failed deployment"
                        >
                          <ArrowLeftCircle className="h-4 w-4" />
                          Cannot Rollback (Failed)
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Info box */}
        {rollbackHistory.availableDeployments.length > 0 && (
          <div className="mt-6 p-4 border border-blue-200 bg-blue-50 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-blue-800">
                  About Rollback History
                </p>
                <ul className="text-sm text-blue-700 space-y-1">
                  <li>• Only successful deployments are available for rollback</li>
                  <li>• Deployments are kept according to your retention policy</li>
                  <li>• Older deployments are automatically cleaned up</li>
                  <li>• Rolling back creates a new deployment with the old version</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
