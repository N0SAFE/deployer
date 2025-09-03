'use client'

import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Progress } from '@repo/ui/components/shadcn/progress'
import { ScrollArea } from '@repo/ui/components/shadcn/scroll-area'
import { Checkbox } from '@repo/ui/components/shadcn/checkbox'
import { orpc } from '@/lib/orpc'
import type { JobStatus, JobQueueStats } from '@repo/api-contracts'
import { 
  Play,
  Pause,
  Square,
  RefreshCw,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  Eye,
  RotateCcw,
  Search,
  Activity,
  BarChart3,
  Timer,
  Loader2
} from 'lucide-react'

interface JobManagementInterfaceProps {
  projectId?: string
}

export default function JobManagementInterface({ projectId }: JobManagementInterfaceProps) {
  const [selectedJobs, setSelectedJobs] = useState<string[]>([])
  const [filters, setFilters] = useState({
    queue: '',
    status: '',
    type: '',
    search: ''
  })
  const [selectedJob, setSelectedJob] = useState<string>('')
  const [pagination, setPagination] = useState({ limit: 20, offset: 0 })
  const [autoRefresh, setAutoRefresh] = useState(true)
  const queryClient = useQueryClient()

  // Auto-refresh every 5 seconds
  useEffect(() => {
    if (!autoRefresh) return
    
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['listJobs'] })
      queryClient.invalidateQueries({ queryKey: ['getJobQueueStats'] })
    }, 5000)
    
    return () => clearInterval(interval)
  }, [autoRefresh, queryClient])

  // Fetch jobs list with filters
  const { data: jobsResponse, isLoading: isLoadingJobs, refetch: refetchJobs } = useQuery(
    orpc.orchestration.listJobs.queryOptions({
      input: {
        ...filters,
        projectId,
        ...pagination,
        queue: filters.queue || undefined,
        status: (filters.status || undefined) as 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused' | undefined,
        type: (filters.type || undefined) as 'deployment' | 'scaling' | 'ssl-renewal' | 'health-check' | 'resource-monitoring' | undefined,
      }
    })
  )

  // Fetch queue statistics
  const { data: queueStatsResponse, isLoading: isLoadingStats } = useQuery(
    orpc.orchestration.getJobQueueStats.queryOptions({
      input: { queue: filters.queue || undefined }
    })
  )

  // Fetch selected job details
  const { data: jobDetailsResponse, isLoading: isLoadingJobDetails } = useQuery({
    ...orpc.orchestration.getJob.queryOptions({
      input: { jobId: selectedJob }
    }),
    enabled: !!selectedJob
  })

  // Fetch job history
  const { data: jobHistoryResponse, isLoading: isLoadingHistory } = useQuery({
    ...orpc.orchestration.getJobHistory.queryOptions({
      input: { jobId: selectedJob, limit: 50, offset: 0 }
    }),
    enabled: !!selectedJob
  })

  // Retry jobs mutation
  const retryJobsMutation = useMutation(orpc.orchestration.retryJobs.mutationOptions({
    onSuccess: () => {
      setSelectedJobs([])
      refetchJobs()
    }
  }))

  // Cancel job mutation
  const cancelJobMutation = useMutation(orpc.orchestration.cancelJob.mutationOptions({
    onSuccess: () => {
      refetchJobs()
      if (selectedJob) {
        queryClient.invalidateQueries({
          queryKey: ['getJob', { jobId: selectedJob }]
        })
      }
    }
  }))

  const jobs = jobsResponse?.data?.jobs || []
  const jobsTotal = jobsResponse?.data?.total || 0
  const queueStats = queueStatsResponse?.data?.queues || []
  const totalStats = queueStatsResponse?.data?.totalStats
  const jobDetails = jobDetailsResponse?.data
  const jobHistory = jobHistoryResponse?.data?.history || []

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-600" />
      case 'waiting':
        return <Clock className="h-4 w-4 text-yellow-600" />
      case 'delayed':
        return <Timer className="h-4 w-4 text-orange-600" />
      case 'paused':
        return <Pause className="h-4 w-4 text-gray-600" />
      default:
        return <Activity className="h-4 w-4 text-gray-600" />
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-blue-100 text-blue-800">Active</Badge>
      case 'completed':
        return <Badge className="bg-green-100 text-green-800">Completed</Badge>
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>
      case 'waiting':
        return <Badge className="bg-yellow-100 text-yellow-800">Waiting</Badge>
      case 'delayed':
        return <Badge className="bg-orange-100 text-orange-800">Delayed</Badge>
      case 'paused':
        return <Badge variant="secondary">Paused</Badge>
      default:
        return <Badge variant="outline">Unknown</Badge>
    }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'deployment':
        return <Play className="h-4 w-4" />
      case 'scaling':
        return <BarChart3 className="h-4 w-4" />
      case 'ssl-renewal':
        return <RefreshCw className="h-4 w-4" />
      case 'health-check':
        return <Activity className="h-4 w-4" />
      case 'resource-monitoring':
        return <BarChart3 className="h-4 w-4" />
      default:
        return <Activity className="h-4 w-4" />
    }
  }

  const formatDuration = (duration?: number) => {
    if (!duration) return 'N/A'
    const minutes = Math.floor(duration / 60000)
    const seconds = Math.floor((duration % 60000) / 1000)
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
  }

  const handleRetryJobs = () => {
    if (selectedJobs.length === 0) return
    retryJobsMutation.mutate({ jobIds: selectedJobs })
  }

  const handleCancelJob = (jobId: string, reason?: string) => {
    cancelJobMutation.mutate({ jobId, reason })
  }

  const handleSelectAllJobs = (checked: boolean) => {
    if (checked) {
      setSelectedJobs(jobs.filter((job: JobStatus) => job.status === 'failed').map((job: JobStatus) => job.id))
    } else {
      setSelectedJobs([])
    }
  }

  const handleJobSelect = (jobId: string, checked: boolean) => {
    if (checked) {
      setSelectedJobs(prev => [...prev, jobId])
    } else {
      setSelectedJobs(prev => prev.filter(id => id !== jobId))
    }
  }

  const canRetryJob = (job: JobStatus) => {
    return job.status === 'failed' || (job.status === 'completed' && job.attempts < job.maxAttempts)
  }

  const canCancelJob = (job: JobStatus) => {
    return job.status === 'waiting' || job.status === 'active' || job.status === 'delayed'
  }

  if (isLoadingJobs || isLoadingStats) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Job Management Interface
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
            <p className="text-muted-foreground">Loading job management data...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Job Management Interface
            </CardTitle>
            <div className="flex items-center gap-2">
              <Label className="text-sm flex items-center gap-2">
                <Checkbox
                  checked={autoRefresh}
                  onCheckedChange={(checked: boolean) => setAutoRefresh(checked)}
                />
                Auto-refresh
              </Label>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => {
                  refetchJobs()
                  queryClient.invalidateQueries({ queryKey: ['getJobQueueStats'] })
                }}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Queue Statistics Overview */}
          {totalStats && (
            <div className="mb-6">
              <h3 className="text-lg font-medium mb-3">Queue Overview</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold">{totalStats.totalJobs}</div>
                      <p className="text-sm text-muted-foreground">Total Jobs</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-yellow-600">{totalStats.totalWaiting}</div>
                      <p className="text-sm text-muted-foreground">Waiting</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-600">{totalStats.totalActive}</div>
                      <p className="text-sm text-muted-foreground">Active</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600">{totalStats.totalCompleted}</div>
                      <p className="text-sm text-muted-foreground">Completed</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-red-600">{totalStats.totalFailed}</div>
                      <p className="text-sm text-muted-foreground">Failed</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold">{totalStats.avgThroughput.toFixed(1)}</div>
                      <p className="text-sm text-muted-foreground">Jobs/min</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold">{formatDuration(totalStats.avgProcessingTime)}</div>
                      <p className="text-sm text-muted-foreground">Avg Time</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {/* Queue-specific stats */}
          {queueStats.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-medium mb-3">Queue Breakdown</h3>
              <div className="space-y-3">
                {queueStats.map((queue: JobQueueStats) => (
                  <Card key={queue.queue}>
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium">{queue.queue}</h4>
                        <div className="text-sm text-muted-foreground">
                          {queue.throughput.perMinute.toFixed(1)} jobs/min
                        </div>
                      </div>
                      <div className="grid grid-cols-6 gap-2 text-sm">
                        <div className="text-center">
                          <div className="font-medium text-yellow-600">{queue.waiting}</div>
                          <div className="text-muted-foreground">Waiting</div>
                        </div>
                        <div className="text-center">
                          <div className="font-medium text-blue-600">{queue.active}</div>
                          <div className="text-muted-foreground">Active</div>
                        </div>
                        <div className="text-center">
                          <div className="font-medium text-green-600">{queue.completed}</div>
                          <div className="text-muted-foreground">Done</div>
                        </div>
                        <div className="text-center">
                          <div className="font-medium text-red-600">{queue.failed}</div>
                          <div className="text-muted-foreground">Failed</div>
                        </div>
                        <div className="text-center">
                          <div className="font-medium">{formatDuration(queue.avgProcessingTime)}</div>
                          <div className="text-muted-foreground">Avg Time</div>
                        </div>
                        <div className="text-center">
                          <div className="font-medium">{formatDuration(queue.avgWaitingTime)}</div>
                          <div className="text-muted-foreground">Avg Wait</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Alerts for failed jobs */}
          {totalStats && totalStats.totalFailed > 0 && (
            <Alert className="mb-6">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Failed Jobs Detected</AlertTitle>
              <AlertDescription>
                {totalStats.totalFailed} job(s) have failed and may need attention. Consider retrying or investigating the errors.
              </AlertDescription>
            </Alert>
          )}

          <Tabs defaultValue="jobs" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="jobs">Job List</TabsTrigger>
              <TabsTrigger value="details">Job Details</TabsTrigger>
            </TabsList>

            <TabsContent value="jobs" className="space-y-4">
              {/* Filters and Search */}
              <div className="flex flex-wrap gap-4 p-4 bg-muted rounded-lg">
                <div className="flex-1 min-w-[200px]">
                  <Label htmlFor="search">Search Jobs</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="search"
                      placeholder="Search by job name or data..."
                      value={filters.search}
                      onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                      className="pl-10"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="status-filter">Status</Label>
                  <Select value={filters.status || 'all-statuses'} onValueChange={(value) => setFilters(prev => ({ ...prev, status: value === 'all-statuses' ? '' : value }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="All Statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all-statuses">All Statuses</SelectItem>
                      <SelectItem value="waiting">Waiting</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                      <SelectItem value="delayed">Delayed</SelectItem>
                      <SelectItem value="paused">Paused</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="type-filter">Type</Label>
                  <Select value={filters.type || 'all-types'} onValueChange={(value) => setFilters(prev => ({ ...prev, type: value === 'all-types' ? '' : value }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="All Types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all-types">All Types</SelectItem>
                      <SelectItem value="deployment">Deployment</SelectItem>
                      <SelectItem value="scaling">Scaling</SelectItem>
                      <SelectItem value="ssl-renewal">SSL Renewal</SelectItem>
                      <SelectItem value="health-check">Health Check</SelectItem>
                      <SelectItem value="resource-monitoring">Resource Monitoring</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="queue-filter">Queue</Label>
                  <Select value={filters.queue || 'all-queues'} onValueChange={(value) => setFilters(prev => ({ ...prev, queue: value === 'all-queues' ? '' : value }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="All Queues" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all-queues">All Queues</SelectItem>
                      {queueStats.map((queue: JobQueueStats) => (
                        <SelectItem key={queue.queue} value={queue.queue}>
                          {queue.queue}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Bulk Actions */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={selectedJobs.length > 0 && selectedJobs.length === jobs.filter((job: JobStatus) => job.status === 'failed').length}
                    onCheckedChange={handleSelectAllJobs}
                  />
                  <Label className="text-sm">
                    Select all failed jobs ({jobs.filter((job: JobStatus) => job.status === 'failed').length})
                  </Label>
                </div>
                {selectedJobs.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {selectedJobs.length} selected
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRetryJobs}
                      disabled={retryJobsMutation.isPending}
                    >
                      <RotateCcw className="h-4 w-4 mr-1" />
                      Retry Selected
                    </Button>
                  </div>
                )}
              </div>

              {/* Jobs List */}
              {jobs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Activity className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No jobs found</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {jobs.map((job: JobStatus) => (
                    <Card key={job.id} className="transition-all hover:shadow-md">
                      <CardContent className="pt-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1">
                            <Checkbox
                              checked={selectedJobs.includes(job.id)}
                              onCheckedChange={(checked: boolean) => handleJobSelect(job.id, checked)}
                              disabled={!canRetryJob(job)}
                            />
                            {getStatusIcon(job.status)}
                            {getTypeIcon(job.type)}
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="font-medium">{job.name}</h3>
                                {getStatusBadge(job.status)}
                                <Badge variant="outline">{job.type}</Badge>
                                <Badge variant="secondary">{job.queue}</Badge>
                              </div>
                              <div className="text-sm text-muted-foreground">
                                <span className="mr-4">Priority: {job.priority}</span>
                                <span className="mr-4">Attempts: {job.attempts}/{job.maxAttempts}</span>
                                <span>Created: {new Date(job.createdAt).toLocaleString()}</span>
                              </div>
                              {job.progress > 0 && job.status === 'active' && (
                                <div className="mt-2">
                                  <div className="flex items-center justify-between text-sm mb-1">
                                    <span>Progress</span>
                                    <span>{job.progress}%</span>
                                  </div>
                                  <Progress value={job.progress} className="h-2" />
                                </div>
                              )}
                              {job.error && (
                                <div className="mt-2">
                                  <Alert variant="destructive">
                                    <AlertTriangle className="h-4 w-4" />
                                    <AlertDescription className="text-sm">
                                      {job.error}
                                    </AlertDescription>
                                  </Alert>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedJob(job.id)}
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              View
                            </Button>
                            {canRetryJob(job) && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => retryJobsMutation.mutate({ jobIds: [job.id] })}
                                disabled={retryJobsMutation.isPending}
                              >
                                <RotateCcw className="h-4 w-4 mr-1" />
                                Retry
                              </Button>
                            )}
                            {canCancelJob(job) && (
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => handleCancelJob(job.id, 'Cancelled by user')}
                                disabled={cancelJobMutation.isPending}
                              >
                                <Square className="h-4 w-4 mr-1" />
                                Cancel
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {/* Pagination */}
              {jobsTotal > pagination.limit && (
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Showing {pagination.offset + 1}-{Math.min(pagination.offset + pagination.limit, jobsTotal)} of {jobsTotal}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPagination(prev => ({ ...prev, offset: Math.max(0, prev.offset - prev.limit) }))}
                      disabled={pagination.offset === 0}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPagination(prev => ({ ...prev, offset: prev.offset + prev.limit }))}
                      disabled={pagination.offset + pagination.limit >= jobsTotal}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="details" className="space-y-4">
              <div>
                <Label htmlFor="job-id-input">Job ID</Label>
                <Input
                  id="job-id-input"
                  placeholder="Enter job ID to view details..."
                  value={selectedJob}
                  onChange={(e) => setSelectedJob(e.target.value)}
                  className="mt-1"
                />
              </div>

              {selectedJob && (
                <div className="grid gap-6">
                  {/* Job Details */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Activity className="h-5 w-5" />
                        Job Details - {selectedJob}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {isLoadingJobDetails ? (
                        <div className="text-center py-8">
                          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                          <p className="text-muted-foreground">Loading job details...</p>
                        </div>
                      ) : jobDetails ? (
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            <div>
                              <Label className="text-sm font-medium">Name</Label>
                              <p className="text-sm mt-1 font-mono bg-muted px-2 py-1 rounded">
                                {jobDetails.name}
                              </p>
                            </div>
                            <div>
                              <Label className="text-sm font-medium">Status</Label>
                              <div className="mt-1">
                                {getStatusBadge(jobDetails.status)}
                              </div>
                            </div>
                            <div>
                              <Label className="text-sm font-medium">Type</Label>
                              <div className="mt-1">
                                <Badge variant="outline">{jobDetails.type}</Badge>
                              </div>
                            </div>
                            <div>
                              <Label className="text-sm font-medium">Queue</Label>
                              <p className="text-sm mt-1">{jobDetails.queue}</p>
                            </div>
                            <div>
                              <Label className="text-sm font-medium">Priority</Label>
                              <p className="text-sm mt-1">{jobDetails.priority}</p>
                            </div>
                            <div>
                              <Label className="text-sm font-medium">Attempts</Label>
                              <p className="text-sm mt-1">{jobDetails.attempts}/{jobDetails.maxAttempts}</p>
                            </div>
                            <div>
                              <Label className="text-sm font-medium">Created</Label>
                              <p className="text-sm mt-1">{new Date(jobDetails.createdAt).toLocaleString()}</p>
                            </div>
                            {jobDetails.startedAt && (
                              <div>
                                <Label className="text-sm font-medium">Started</Label>
                                <p className="text-sm mt-1">{new Date(jobDetails.startedAt).toLocaleString()}</p>
                              </div>
                            )}
                            {jobDetails.completedAt && (
                              <div>
                                <Label className="text-sm font-medium">Completed</Label>
                                <p className="text-sm mt-1">{new Date(jobDetails.completedAt).toLocaleString()}</p>
                              </div>
                            )}
                            {jobDetails.duration && (
                              <div>
                                <Label className="text-sm font-medium">Duration</Label>
                                <p className="text-sm mt-1">{formatDuration(jobDetails.duration)}</p>
                              </div>
                            )}
                            {jobDetails.nextRunAt && (
                              <div>
                                <Label className="text-sm font-medium">Next Run</Label>
                                <p className="text-sm mt-1">{new Date(jobDetails.nextRunAt).toLocaleString()}</p>
                              </div>
                            )}
                          </div>

                          {jobDetails.progress > 0 && (
                            <div>
                              <Label className="text-sm font-medium">Progress</Label>
                              <div className="mt-2">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-sm">{jobDetails.progress}% Complete</span>
                                </div>
                                <Progress value={jobDetails.progress} className="h-3" />
                              </div>
                            </div>
                          )}

                          {jobDetails.data && Object.keys(jobDetails.data).length > 0 && (
                            <div>
                              <Label className="text-sm font-medium">Job Data</Label>
                              <ScrollArea className="h-32 mt-2">
                                <pre className="text-xs bg-muted p-2 rounded">
                                  {JSON.stringify(jobDetails.data, null, 2)}
                                </pre>
                              </ScrollArea>
                            </div>
                          )}

                          {jobDetails.result && Object.keys(jobDetails.result).length > 0 && (
                            <div>
                              <Label className="text-sm font-medium">Job Result</Label>
                              <ScrollArea className="h-32 mt-2">
                                <pre className="text-xs bg-muted p-2 rounded">
                                  {JSON.stringify(jobDetails.result, null, 2)}
                                </pre>
                              </ScrollArea>
                            </div>
                          )}

                          {jobDetails.error && (
                            <div>
                              <Label className="text-sm font-medium">Error</Label>
                              <Alert variant="destructive" className="mt-2">
                                <AlertTriangle className="h-4 w-4" />
                                <AlertDescription className="text-sm">
                                  {jobDetails.error}
                                </AlertDescription>
                              </Alert>
                              {jobDetails.stackTrace && (
                                <ScrollArea className="h-32 mt-2">
                                  <pre className="text-xs bg-muted p-2 rounded text-red-700">
                                    {jobDetails.stackTrace}
                                  </pre>
                                </ScrollArea>
                              )}
                            </div>
                          )}

                          <div className="flex gap-2 pt-4">
                            {canRetryJob(jobDetails) && (
                              <Button
                                variant="outline"
                                onClick={() => retryJobsMutation.mutate({ jobIds: [jobDetails.id] })}
                                disabled={retryJobsMutation.isPending}
                              >
                                <RotateCcw className="h-4 w-4 mr-2" />
                                Retry Job
                              </Button>
                            )}
                            {canCancelJob(jobDetails) && (
                              <Button
                                variant="destructive"
                                onClick={() => handleCancelJob(jobDetails.id, 'Cancelled from details view')}
                                disabled={cancelJobMutation.isPending}
                              >
                                <Square className="h-4 w-4 mr-2" />
                                Cancel Job
                              </Button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-8 text-muted-foreground">
                          <AlertTriangle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                          <p>Job not found or error loading details</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Job Logs */}
                  {jobDetails?.logs && jobDetails.logs.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Job Logs</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ScrollArea className="h-64">
                          <div className="space-y-2">
                            {jobDetails.logs.map((log, index) => (
                              <div key={index} className="text-xs font-mono border-l-2 border-muted pl-3 py-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-muted-foreground">
                                    {new Date(log.timestamp).toLocaleTimeString()}
                                  </span>
                                  <Badge 
                                    variant={log.level === 'error' ? 'destructive' : log.level === 'warn' ? 'outline' : 'secondary'}
                                  >
                                    {log.level.toUpperCase()}
                                  </Badge>
                                </div>
                                <p className="mt-1">{log.message}</p>
                                {log.metadata && Object.keys(log.metadata).length > 0 && (
                                  <pre className="text-xs bg-muted p-1 rounded mt-1">
                                    {JSON.stringify(log.metadata, null, 2)}
                                  </pre>
                                )}
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  )}

                  {/* Job History */}
                  {jobHistory.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Job History</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ScrollArea className="h-64">
                          <div className="space-y-3">
                            {jobHistory.map((entry, index) => (
                              <div key={entry.id} className="flex items-start gap-3">
                                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center">
                                  <div className="w-2 h-2 rounded-full bg-primary" />
                                </div>
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline">{entry.status}</Badge>
                                    <span className="text-sm text-muted-foreground">
                                      {new Date(entry.timestamp).toLocaleString()}
                                    </span>
                                  </div>
                                  {entry.message && (
                                    <p className="text-sm mt-1">{entry.message}</p>
                                  )}
                                  {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                                    <pre className="text-xs bg-muted p-2 rounded mt-2">
                                      {JSON.stringify(entry.metadata, null, 2)}
                                    </pre>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}