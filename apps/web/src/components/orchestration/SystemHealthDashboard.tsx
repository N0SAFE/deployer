'use client'

import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Progress } from '@repo/ui/components/shadcn/progress'
import { ScrollArea } from '@repo/ui/components/shadcn/scroll-area'
import { Checkbox } from '@repo/ui/components/shadcn/checkbox'
import { Label } from '@repo/ui/components/shadcn/label'
import { orpc } from '@/lib/orpc'
import type { ServiceHealth, HealthHistoryEntry } from '@repo/api-contracts'
import { 
  Activity,
  Heart,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Server,
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
  Shield,
  BarChart3,
  History,
  Play,
  Loader2
} from 'lucide-react'

interface SystemHealthDashboardProps {
  projectId?: string
}

export default function SystemHealthDashboard({ projectId }: SystemHealthDashboardProps) {
  const [timeRange, setTimeRange] = useState<'1h' | '6h' | '24h' | '7d' | '30d'>('24h')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [selectedService, setSelectedService] = useState<string>('')
  const [historyFilters, setHistoryFilters] = useState({
    eventTypes: [] as string[]
  })
  const queryClient = useQueryClient()

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!autoRefresh) return
    
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['getSystemHealth'] })
      queryClient.invalidateQueries({ queryKey: ['getServiceHealth'] })
      queryClient.invalidateQueries({ queryKey: ['getSystemMetrics'] })
    }, 30000)
    
    return () => clearInterval(interval)
  }, [autoRefresh, queryClient])

  // Fetch system health overview
  const { data: systemHealthResponse, isLoading: isLoadingHealth, refetch: refetchHealth } = useQuery(
    orpc.orchestration.getSystemHealth.queryOptions({
      input: { includeMetrics: true, includeAlerts: true }
    })
  )

  // Fetch service health details
  const { data: serviceHealthResponse, isLoading: isLoadingServices } = useQuery(
    orpc.orchestration.getServiceHealth.queryOptions({
      input: { 
        projectId,
        limit: 100,
        offset: 0
      }
    })
  )

  // Fetch system metrics
  const { data: systemMetricsResponse, isLoading: isLoadingMetrics } = useQuery(
    orpc.orchestration.getSystemMetrics.queryOptions({
      input: { 
        timeRange,
        resolution: timeRange === '1h' ? '1m' : timeRange === '6h' ? '5m' : timeRange === '24h' ? '15m' : timeRange === '7d' ? '1h' : '1d',
        includeProjection: true
      }
    })
  )

  // Fetch health history
  const { data: healthHistoryResponse, isLoading: isLoadingHistory } = useQuery(
    orpc.orchestration.getHealthHistory.queryOptions({
      input: {
        serviceId: selectedService || undefined,
        timeRange,
        eventTypes: historyFilters.eventTypes.length > 0 ? 
          historyFilters.eventTypes as ('status_change' | 'failure' | 'recovery' | 'timeout' | 'error')[] : 
          undefined,
        limit: 100,
        offset: 0
      }
    })
  )

  // Run health check mutation
  const runHealthCheckMutation = useMutation(orpc.orchestration.runHealthCheck.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['getSystemHealth'] })
      queryClient.invalidateQueries({ queryKey: ['getServiceHealth'] })
    }
  }))

  const systemHealth = systemHealthResponse?.data
  const services = serviceHealthResponse?.data?.services || []
  const metrics = systemMetricsResponse?.data
  const healthHistory = healthHistoryResponse?.data

  const getHealthStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />
      case 'degraded':
        return <AlertTriangle className="h-4 w-4 text-yellow-600" />
      case 'unhealthy':
        return <XCircle className="h-4 w-4 text-red-600" />
      case 'critical':
        return <XCircle className="h-4 w-4 text-red-800" />
      default:
        return <Clock className="h-4 w-4 text-gray-600" />
    }
  }

  const getHealthStatusBadge = (status: string) => {
    switch (status) {
      case 'healthy':
        return <Badge className="bg-green-100 text-green-800">Healthy</Badge>
      case 'degraded':
        return <Badge className="bg-yellow-100 text-yellow-800">Degraded</Badge>
      case 'unhealthy':
        return <Badge variant="destructive">Unhealthy</Badge>
      case 'critical':
        return <Badge variant="destructive" className="bg-red-800">Critical</Badge>
      default:
        return <Badge variant="secondary">Unknown</Badge>
    }
  }

  const getResourceStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-yellow-600" />
      case 'critical':
        return <XCircle className="h-5 w-5 text-red-600" />
      default:
        return <Clock className="h-5 w-5 text-gray-600" />
    }
  }

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'increasing':
      case 'improving':
        return <TrendingUp className="h-4 w-4 text-green-600" />
      case 'decreasing':
      case 'degrading':
        return <TrendingDown className="h-4 w-4 text-red-600" />
      case 'stable':
        return <Minus className="h-4 w-4 text-gray-600" />
      default:
        return <Activity className="h-4 w-4 text-gray-600" />
    }
  }

  const formatUptime = (uptime: number) => {
    const days = Math.floor(uptime / 86400)
    const hours = Math.floor((uptime % 86400) / 3600)
    const minutes = Math.floor((uptime % 3600) / 60)
    
    if (days > 0) return `${days}d ${hours}h`
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  }

  const formatPercentage = (value: number) => {
    return `${value.toFixed(1)}%`
  }

  const formatBytes = (bytes: number) => {
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    if (bytes === 0) return '0 B'
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`
  }

  const handleRunHealthCheck = (serviceId?: string) => {
    runHealthCheckMutation.mutate({
      serviceId,
      force: true
    })
  }

  const handleEventTypeFilter = (eventType: string, checked: boolean) => {
    setHistoryFilters(prev => ({
      ...prev,
      eventTypes: checked 
        ? [...prev.eventTypes, eventType]
        : prev.eventTypes.filter(type => type !== eventType)
    }))
  }

  if (isLoadingHealth || isLoadingServices) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Heart className="h-5 w-5" />
            System Health Dashboard
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
            <p className="text-muted-foreground">Loading system health data...</p>
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
              <Heart className="h-5 w-5" />
              System Health Dashboard
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
                  refetchHealth()
                  queryClient.invalidateQueries({ queryKey: ['getServiceHealth'] })
                  queryClient.invalidateQueries({ queryKey: ['getSystemMetrics'] })
                }}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleRunHealthCheck()}
                disabled={runHealthCheckMutation.isPending}
              >
                <Play className="h-4 w-4 mr-2" />
                Run All Checks
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Overall System Status */}
          {systemHealth && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  {getHealthStatusIcon(systemHealth.overallStatus)}
                  <div>
                    <h2 className="text-2xl font-bold">System Status</h2>
                    {getHealthStatusBadge(systemHealth.overallStatus)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-muted-foreground">System Uptime</div>
                  <div className="text-lg font-semibold">{formatUptime(systemHealth.systemUptime)}</div>
                </div>
              </div>

              {/* System Overview Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600">{systemHealth.healthyServices}</div>
                      <div className="text-2xl font-bold text-muted-foreground">/ {systemHealth.totalServices}</div>
                      <p className="text-sm text-muted-foreground">Healthy Services</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600">{systemHealth.passingHealthChecks}</div>
                      <div className="text-2xl font-bold text-muted-foreground">/ {systemHealth.totalHealthChecks}</div>
                      <p className="text-sm text-muted-foreground">Passing Checks</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-yellow-600">{systemHealth.degradedServices}</div>
                      <p className="text-sm text-muted-foreground">Degraded</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-red-600">{systemHealth.unhealthyServices}</div>
                      <p className="text-sm text-muted-foreground">Unhealthy</p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Resource Health Status */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Cpu className="h-5 w-5" />
                        <span className="font-medium">CPU</span>
                      </div>
                      {getResourceStatusIcon(systemHealth.resourceHealth.cpu)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <MemoryStick className="h-5 w-5" />
                        <span className="font-medium">Memory</span>
                      </div>
                      {getResourceStatusIcon(systemHealth.resourceHealth.memory)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <HardDrive className="h-5 w-5" />
                        <span className="font-medium">Disk</span>
                      </div>
                      {getResourceStatusIcon(systemHealth.resourceHealth.disk)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Network className="h-5 w-5" />
                        <span className="font-medium">Network</span>
                      </div>
                      {getResourceStatusIcon(systemHealth.resourceHealth.network)}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Alerts Summary */}
              {(systemHealth.alertCount.critical > 0 || systemHealth.alertCount.warning > 0) && (
                <div className="mb-6">
                  <h3 className="text-lg font-medium mb-3">Active Alerts</h3>
                  <div className="grid grid-cols-3 gap-4">
                    {systemHealth.alertCount.critical > 0 && (
                      <Alert variant="destructive">
                        <XCircle className="h-4 w-4" />
                        <AlertTitle>Critical Alerts</AlertTitle>
                        <AlertDescription>
                          {systemHealth.alertCount.critical} critical alert(s) require immediate attention
                        </AlertDescription>
                      </Alert>
                    )}
                    {systemHealth.alertCount.warning > 0 && (
                      <Alert>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Warning Alerts</AlertTitle>
                        <AlertDescription>
                          {systemHealth.alertCount.warning} warning alert(s) detected
                        </AlertDescription>
                      </Alert>
                    )}
                    {systemHealth.alertCount.info > 0 && (
                      <Alert>
                        <Shield className="h-4 w-4" />
                        <AlertTitle>Info Alerts</AlertTitle>
                        <AlertDescription>
                          {systemHealth.alertCount.info} informational alert(s)
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <Tabs defaultValue="services" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="services">Services</TabsTrigger>
              <TabsTrigger value="metrics">Metrics</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="trends">Trends</TabsTrigger>
            </TabsList>

            <TabsContent value="services" className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">Service Health Status</h3>
                <div className="text-sm text-muted-foreground">
                  Last updated: {systemHealth?.lastUpdated ? new Date(systemHealth.lastUpdated).toLocaleString() : 'Never'}
                </div>
              </div>

              {services.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Server className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No services found</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {services.map((service: ServiceHealth) => (
                    <Card key={service.serviceId} className="transition-all hover:shadow-md">
                      <CardContent className="pt-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1">
                            {getHealthStatusIcon(service.status)}
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-medium">{service.serviceName}</h4>
                                {getHealthStatusBadge(service.status)}
                                <Badge variant="outline">{service.stackName}</Badge>
                              </div>
                              <div className="text-sm text-muted-foreground mb-2">
                                <span className="mr-4">
                                  Replicas: {service.replicas.running}/{service.replicas.desired} 
                                  ({service.replicas.healthy} healthy)
                                </span>
                                <span className="mr-4">Uptime: {formatUptime(service.uptime)}</span>
                                <span>Errors: {service.errorCount}</span>
                              </div>
                              
                              {/* Health Checks Summary */}
                              {service.healthChecks.length > 0 && (
                                <div className="mb-2">
                                  <div className="flex items-center gap-2 text-sm">
                                    <span>Health Checks:</span>
                                    {service.healthChecks.map((check) => (
                                      <div key={check.id} className="flex items-center gap-1">
                                        {getHealthStatusIcon(check.status)}
                                        <span className="text-xs">{check.name}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Resource Usage */}
                              {service.averageResponseTime && (
                                <div className="text-sm">
                                  <span className="text-muted-foreground">Avg Response Time: </span>
                                  <span className="font-mono">{service.averageResponseTime}ms</span>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedService(service.serviceId)}
                            >
                              <History className="h-4 w-4 mr-1" />
                              History
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRunHealthCheck(service.serviceId)}
                              disabled={runHealthCheckMutation.isPending}
                            >
                              <Play className="h-4 w-4 mr-1" />
                              Check
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="metrics" className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">System Metrics</h3>
                <Select value={timeRange} onValueChange={(value: '1h' | '6h' | '24h' | '7d' | '30d') => setTimeRange(value)}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1h">Last Hour</SelectItem>
                    <SelectItem value="6h">Last 6 Hours</SelectItem>
                    <SelectItem value="24h">Last 24 Hours</SelectItem>
                    <SelectItem value="7d">Last 7 Days</SelectItem>
                    <SelectItem value="30d">Last 30 Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {isLoadingMetrics ? (
                <div className="text-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                  <p className="text-muted-foreground">Loading metrics data...</p>
                </div>
              ) : metrics ? (
                <div className="space-y-6">
                  {/* Aggregated Metrics */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Card>
                      <CardContent className="pt-4">
                        <div className="text-center">
                          <div className="text-2xl font-bold">{formatPercentage(metrics.aggregated.avgCpuUsage)}</div>
                          <p className="text-sm text-muted-foreground">Avg CPU Usage</p>
                          <div className="text-xs text-muted-foreground mt-1">
                            Peak: {formatPercentage(metrics.aggregated.peakCpuUsage)}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <div className="text-center">
                          <div className="text-2xl font-bold">{formatPercentage(metrics.aggregated.avgMemoryUsage)}</div>
                          <p className="text-sm text-muted-foreground">Avg Memory Usage</p>
                          <div className="text-xs text-muted-foreground mt-1">
                            Peak: {formatPercentage(metrics.aggregated.peakMemoryUsage)}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <div className="text-center">
                          <div className="text-2xl font-bold">{formatPercentage(metrics.aggregated.avgDiskUsage)}</div>
                          <p className="text-sm text-muted-foreground">Avg Disk Usage</p>
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <div className="text-center">
                          <div className="text-2xl font-bold">{formatBytes(metrics.aggregated.avgNetworkThroughput)}/s</div>
                          <p className="text-sm text-muted-foreground">Avg Network</p>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Reliability and Uptime */}
                  <div className="grid grid-cols-2 gap-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">System Reliability</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm">Reliability Score</span>
                            <span className="font-mono">{formatPercentage(metrics.aggregated.reliabilityScore)}</span>
                          </div>
                          <Progress value={metrics.aggregated.reliabilityScore} className="h-2" />
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Total Uptime</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-center">
                          <div className="text-2xl font-bold">{formatUptime(metrics.aggregated.totalUptime)}</div>
                          <p className="text-sm text-muted-foreground">System uptime this period</p>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Trends (if available) */}
                  {metrics.trends && (
                    <div>
                      <h4 className="text-lg font-medium mb-3">Performance Trends</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <Card>
                          <CardContent className="pt-4">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">CPU Trend</span>
                              {getTrendIcon(metrics.trends.cpuTrend)}
                            </div>
                            <p className="text-xs text-muted-foreground capitalize">{metrics.trends.cpuTrend}</p>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardContent className="pt-4">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">Memory Trend</span>
                              {getTrendIcon(metrics.trends.memoryTrend)}
                            </div>
                            <p className="text-xs text-muted-foreground capitalize">{metrics.trends.memoryTrend}</p>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardContent className="pt-4">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">Disk Trend</span>
                              {getTrendIcon(metrics.trends.diskTrend)}
                            </div>
                            <p className="text-xs text-muted-foreground capitalize">{metrics.trends.diskTrend}</p>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardContent className="pt-4">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">Service Health</span>
                              {getTrendIcon(metrics.trends.serviceTrend)}
                            </div>
                            <p className="text-xs text-muted-foreground capitalize">{metrics.trends.serviceTrend}</p>
                          </CardContent>
                        </Card>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <BarChart3 className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No metrics data available</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="history" className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">Health Check History</h3>
                <div className="flex items-center gap-2">
                  <Select value={timeRange} onValueChange={(value: '1h' | '6h' | '24h' | '7d' | '30d') => setTimeRange(value)}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1h">Last Hour</SelectItem>
                      <SelectItem value="6h">Last 6 Hours</SelectItem>
                      <SelectItem value="24h">Last 24 Hours</SelectItem>
                      <SelectItem value="7d">Last 7 Days</SelectItem>
                      <SelectItem value="30d">Last 30 Days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Event Type Filters */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Filter by Event Type</Label>
                <div className="flex flex-wrap gap-2">
                  {['status_change', 'failure', 'recovery', 'timeout', 'error'].map((eventType) => (
                    <div key={eventType} className="flex items-center space-x-2">
                      <Checkbox
                        id={eventType}
                        checked={historyFilters.eventTypes.includes(eventType)}
                        onCheckedChange={(checked: boolean) => handleEventTypeFilter(eventType, checked)}
                      />
                      <Label htmlFor={eventType} className="text-sm capitalize">
                        {eventType.replace('_', ' ')}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              {isLoadingHistory ? (
                <div className="text-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                  <p className="text-muted-foreground">Loading health history...</p>
                </div>
              ) : healthHistory?.history ? (
                <div className="space-y-4">
                  {/* History Summary */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <Card>
                      <CardContent className="pt-4">
                        <div className="text-center">
                          <div className="text-2xl font-bold">{healthHistory.summary.totalEvents}</div>
                          <p className="text-sm text-muted-foreground">Total Events</p>
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-green-600">
                            {formatPercentage(healthHistory.summary.uptimePercentage)}
                          </div>
                          <p className="text-sm text-muted-foreground">Uptime</p>
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <div className="text-center">
                          <div className="text-2xl font-bold">{formatUptime(healthHistory.summary.mttr)}</div>
                          <p className="text-sm text-muted-foreground">MTTR</p>
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <div className="text-center">
                          <div className="text-2xl font-bold">{formatUptime(healthHistory.summary.mtbf)}</div>
                          <p className="text-sm text-muted-foreground">MTBF</p>
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-blue-600">
                            {healthHistory.summary.availabilityScore.toFixed(1)}
                          </div>
                          <p className="text-sm text-muted-foreground">Availability</p>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* History Timeline */}
                  <ScrollArea className="h-96">
                    <div className="space-y-3">
                      {healthHistory.history.map((entry: HealthHistoryEntry) => (
                        <Card key={entry.id}>
                          <CardContent className="pt-4">
                            <div className="flex items-start gap-3">
                              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center">
                                {getHealthStatusIcon(entry.newStatus)}
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <h4 className="font-medium">{entry.serviceName}</h4>
                                  <Badge variant="outline">{entry.healthCheckName}</Badge>
                                  <span className="text-sm text-muted-foreground">
                                    {entry.previousStatus} → {entry.newStatus}
                                  </span>
                                </div>
                                <div className="text-sm text-muted-foreground mb-1">
                                  {new Date(entry.timestamp).toLocaleString()}
                                  {entry.responseTime && (
                                    <span className="ml-4">Response: {entry.responseTime}ms</span>
                                  )}
                                  <span className="ml-4">Duration: {formatUptime(entry.duration)}</span>
                                </div>
                                {entry.errorMessage && (
                                  <Alert variant="destructive" className="mt-2">
                                    <AlertTriangle className="h-4 w-4" />
                                    <AlertDescription className="text-sm">
                                      {entry.errorMessage}
                                    </AlertDescription>
                                  </Alert>
                                )}
                                {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                                  <details className="mt-2">
                                    <summary className="text-sm cursor-pointer">Show metadata</summary>
                                    <pre className="text-xs bg-muted p-2 rounded mt-1">
                                      {JSON.stringify(entry.metadata, null, 2)}
                                    </pre>
                                  </details>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <History className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No health history available</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="trends" className="space-y-4">
              <div className="text-center py-8 text-muted-foreground">
                <BarChart3 className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>Trend visualization charts will be implemented with a charting library</p>
                <p className="text-xs mt-2">This would show time-series charts for CPU, memory, disk, and service health trends</p>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}