'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Progress } from '@repo/ui/components/shadcn/progress'
import {
  Clock,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Package,
  Cog,
  PauseCircle,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { orpc } from '@/lib/orpc'

interface DeploymentStatusTrackerProps {
  deploymentId: string
  jobId: string
  onComplete?: () => void
  onError?: (error: string) => void
}


const getStatusIcon = (status: string) => {
  switch (status) {
    case 'waiting':
      return <Clock className="h-4 w-4 text-yellow-600" />
    case 'active':
      return <Cog className="h-4 w-4 animate-spin text-blue-600" />
    case 'completed':
      return <CheckCircle className="h-4 w-4 text-green-600" />
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-600" />
    case 'delayed':
      return <PauseCircle className="h-4 w-4 text-orange-600" />
    default:
      return <AlertCircle className="h-4 w-4 text-gray-600" />
  }
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'waiting':
      return 'yellow'
    case 'active':
      return 'blue'
    case 'completed':
      return 'green'
    case 'failed':
      return 'red'
    case 'delayed':
      return 'orange'
    default:
      return 'gray'
  }
}

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'waiting':
      return 'Queued'
    case 'active':
      return 'Deploying'
    case 'completed':
      return 'Completed'
    case 'failed':
      return 'Failed'
    case 'delayed':
      return 'Delayed'
    default:
      return status
  }
}

const formatTime = (timestamp: string) => {
  return new Date(timestamp).toLocaleTimeString()
}

const formatDuration = (start: string, end?: string) => {
  const startTime = new Date(start)
  const endTime = end ? new Date(end) : new Date()
  const duration = endTime.getTime() - startTime.getTime()
  
  if (duration < 60000) {
    return `${Math.round(duration / 1000)}s`
  } else if (duration < 3600000) {
    return `${Math.round(duration / 60000)}m`
  } else {
    return `${Math.round(duration / 3600000)}h`
  }
}

export default function DeploymentStatusTracker({
  deploymentId,
  jobId,
  onComplete,
  onError,
}: DeploymentStatusTrackerProps) {
  const [pollingInterval, setPollingInterval] = useState(2000) // 2 seconds
  
  // Get deployment status
  useQuery(
    orpc.deployment.getStatus.queryOptions({
      input: { deploymentId },
      staleTime: 0,
      refetchInterval: pollingInterval,
    })
  )

  // Real job status query using ORPC contract
  const { data: jobStatus, refetch: refetchJob } = useQuery(
    orpc.deployment.jobStatus.queryOptions({
      input: { jobId },
      staleTime: 0,
      refetchInterval: pollingInterval,
    })
  )

  // Stop polling when deployment is complete or failed
  useEffect(() => {
    if (jobStatus) {
      if (jobStatus.status === 'completed') {
        setPollingInterval(0) // Stop polling
        onComplete?.()
        toast.success('Deployment completed successfully!')
      } else if (jobStatus.status === 'failed') {
        setPollingInterval(0) // Stop polling
        onError?.(jobStatus.failedReason || 'Deployment failed')
        toast.error('Deployment failed')
      }
    }
  }, [jobStatus, onComplete, onError])

  if (!jobStatus) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <RefreshCw className="h-6 w-6 animate-spin text-blue-600 mr-2" />
            <span>Loading deployment status...</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Main Status Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Deployment Status
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge 
                variant={jobStatus.status === 'completed' ? 'default' : 'secondary'}
                className={`bg-${getStatusColor(jobStatus.status)}-100 text-${getStatusColor(jobStatus.status)}-800`}
              >
                {getStatusIcon(jobStatus.status)}
                <span className="ml-1">{getStatusLabel(jobStatus.status)}</span>
              </Badge>
              <Button
                size="sm"
                variant="outline"
                onClick={() => refetchJob()}
                disabled={jobStatus.status === 'completed' || jobStatus.status === 'failed'}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Progress Bar */}
          {jobStatus.status === 'active' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Progress</span>
                <span className="text-sm text-gray-600">{Math.round(jobStatus.progress)}%</span>
              </div>
              <Progress value={jobStatus.progress} className="h-2" />
            </div>
          )}

          {/* Job Details */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-gray-600">Job ID</p>
              <p className="font-mono text-sm">{jobId.slice(0, 12)}...</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Deployment ID</p>
              <p className="font-mono text-sm">{deploymentId.slice(0, 12)}...</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Started</p>
              <p className="text-sm">{formatTime(jobStatus.timestamp)}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Duration</p>
              <p className="text-sm">
                {formatDuration(jobStatus.timestamp, jobStatus.finishedOn)}
              </p>
            </div>
          </div>

          {/* Error Details */}
          {jobStatus.status === 'failed' && jobStatus.failedReason && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <XCircle className="h-4 w-4 text-red-600" />
                <span className="font-medium text-red-800">Deployment Failed</span>
              </div>
              <p className="text-sm text-red-700">{jobStatus.failedReason}</p>
            </div>
          )}

          {/* Success Details */}
          {jobStatus.status === 'completed' && jobStatus.result && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span className="font-medium text-green-800">Deployment Successful</span>
              </div>
              <div className="space-y-2">
                {jobStatus.result.deploymentUrl && (
                  <div>
                    <p className="text-sm font-medium text-green-800">Deployment URL:</p>
                    <a 
                      href={jobStatus.result.deploymentUrl}
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-sm text-green-700 underline hover:text-green-900"
                    >
                      {jobStatus.result.deploymentUrl}
                    </a>
                  </div>
                )}
                {jobStatus.result.staticFiles && (
                  <p className="text-sm text-green-700">
                    Static Files: {jobStatus.result.staticFiles}
                  </p>
                )}
                {jobStatus.result.buildTime && (
                  <p className="text-sm text-green-700">
                    Build Time: {jobStatus.result.buildTime}
                  </p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deployment Steps */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cog className="h-5 w-5" />
            Deployment Steps
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Step 1: Upload Processing */}
            <div className="flex items-center gap-3">
              {jobStatus.status !== 'waiting' ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : (
                <Clock className="h-5 w-5 text-gray-400" />
              )}
              <div className="flex-1">
                <p className="font-medium">File Processing</p>
                <p className="text-sm text-gray-600">Extracting and analyzing uploaded files</p>
              </div>
            </div>

            {/* Step 2: Building */}
            <div className="flex items-center gap-3">
              {jobStatus.status === 'completed' ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : jobStatus.status === 'active' ? (
                <Cog className="h-5 w-5 animate-spin text-blue-600" />
              ) : (
                <Clock className="h-5 w-5 text-gray-400" />
              )}
              <div className="flex-1">
                <p className="font-medium">Building Application</p>
                <p className="text-sm text-gray-600">Installing dependencies and building assets</p>
              </div>
            </div>

            {/* Step 3: Deployment */}
            <div className="flex items-center gap-3">
              {jobStatus.status === 'completed' ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : (
                <Clock className="h-5 w-5 text-gray-400" />
              )}
              <div className="flex-1">
                <p className="font-medium">Deploying to Service</p>
                <p className="text-sm text-gray-600">Starting containers and configuring routing</p>
              </div>
            </div>

            {/* Step 4: Health Check */}
            <div className="flex items-center gap-3">
              {jobStatus.status === 'completed' ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : (
                <Clock className="h-5 w-5 text-gray-400" />
              )}
              <div className="flex-1">
                <p className="font-medium">Health Check</p>
                <p className="text-sm text-gray-600">Verifying deployment is running correctly</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}