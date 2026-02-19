'use client'

import React, { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Progress } from '@repo/ui/components/shadcn/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { 
  Activity, 
  Cpu, 
  HardDrive, 
  MemoryStick, 
  RefreshCw, 
  AlertTriangle,
  Filter,
  Calendar
} from 'lucide-react'
import ResourceMetricsChart from './ResourceMetricsChart'
import { orpc } from '@/lib/orpc'
import { useQuery } from '@tanstack/react-query'

interface ResourceMetric {
  id: string
  stackId: string
  metricType: 'cpu' | 'memory' | 'disk' | 'network_in' | 'network_out'
  value: number
  unit: string
  timestamp: Date
  threshold?: number
}

interface StackResourceData {
  stackId: string
  stackName: string
  cpuMetrics: ResourceMetric[]
  memoryMetrics: ResourceMetric[]
  diskMetrics: ResourceMetric[]
  networkInMetrics: ResourceMetric[]
  networkOutMetrics: ResourceMetric[]
  cpuQuota: number
  memoryQuota: number
  diskQuota: number
}

interface Stack {
  id: string
  name: string
  [key: string]: unknown
}

export function ResourceMonitoringDashboard({ projectId }: { projectId: string }) {
  const [selectedTimeRange, setSelectedTimeRange] = useState<'1h' | '6h' | '24h' | '7d'>('6h')
  const [selectedStack, setSelectedStack] = useState<string>('all')
  const [alertFilter, setAlertFilter] = useState<'all' | 'warning' | 'critical'>('all')
  const [autoRefresh, setAutoRefresh] = useState(true)

  // Fetch resource summary
  const { data: resourceSummary, isLoading: summaryLoading, refetch: refetchSummary } = useQuery(orpc.orchestration.getSystemResourceSummary.queryOptions({
    input: void 0,
    refetchInterval: autoRefresh ? 30000 : false, // Refresh every 30 seconds if enabled
  }))

  // Fetch resource alerts
  const { data: resourceAlerts, isLoading: alertsLoading } = useQuery(orpc.orchestration.getResourceAlerts.queryOptions({
    input: void 0,
    refetchInterval: autoRefresh ? 10000 : false
  }))

  // Fetch stacks for filtering
  const { data: stacks } = useQuery(orpc.orchestration.listStacks.queryOptions({
    input: { projectId }
  }))

  // Fetch system metrics using the real API
  const { data: systemMetrics, isLoading: metricsLoading, refetch: refetchMetrics } = useQuery(orpc.orchestration.getSystemMetrics.queryOptions({
    input: { 
      timeRange: selectedTimeRange,
      resolution: selectedTimeRange === '1h' ? '1m' : selectedTimeRange === '6h' ? '5m' : '15m',
      includeProjection: true
    },
    refetchInterval: autoRefresh ? 30000 : false,
  }))

  // Transform API data to component format
  const resourceData: StackResourceData[] = useMemo(() => {
    if (!stacks?.data || !systemMetrics?.data) return []
    
    const metrics = systemMetrics.data.metrics || []
    
    return stacks.data.map((stack: Stack) => {
      // For now, use system-wide metrics for each stack
      // Later this can be enhanced to filter per-stack metrics
      const cpuMetrics = metrics.map((metric, i) => ({
        id: `cpu-${stack.id}-${i}`,
        stackId: stack.id,
        metricType: 'cpu' as const,
        value: metric.cpu.usage,
        unit: '%',
        timestamp: metric.timestamp,
        threshold: 80
      }))

      const memoryMetrics = metrics.map((metric, i) => ({
        id: `memory-${stack.id}-${i}`,
        stackId: stack.id,
        metricType: 'memory' as const,
        value: metric.memory.usage,
        unit: '%',
        timestamp: metric.timestamp,
        threshold: 85
      }))

      const diskMetrics = metrics.map((metric, i) => ({
        id: `disk-${stack.id}-${i}`,
        stackId: stack.id,
        metricType: 'disk' as const,
        value: metric.disk.usage,
        unit: '%',
        timestamp: metric.timestamp,
        threshold: 90
      }))

      const networkInMetrics = metrics.map((metric, i) => ({
        id: `network_in-${stack.id}-${i}`,
        stackId: stack.id,
        metricType: 'network_in' as const,
        value: metric.network.bytesIn,
        unit: 'B/s',
        timestamp: metric.timestamp,
      }))

      const networkOutMetrics = metrics.map((metric, i) => ({
        id: `network_out-${stack.id}-${i}`,
        stackId: stack.id,
        metricType: 'network_out' as const,
        value: metric.network.bytesOut,
        unit: 'B/s',
        timestamp: metric.timestamp,
      }))

      return {
        stackId: stack.id,
        stackName: stack.name,
        cpuMetrics,
        memoryMetrics,
        diskMetrics,
        networkInMetrics,
        networkOutMetrics,
        cpuQuota: 100, // These could be enhanced to come from stack configuration
        memoryQuota: 100,
        diskQuota: 100
      }
    })
  }, [stacks, systemMetrics])

  const filteredResourceData = selectedStack === 'all' 
    ? resourceData 
    : resourceData.filter(data => data.stackId === selectedStack)

  const handleRefresh = () => {
    refetchSummary()
    refetchMetrics()
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'text-red-600'
      case 'warning': return 'text-yellow-600'
      default: return 'text-gray-600'
    }
  }

  const formatValue = (value: number, unit: string) => {
    if (unit === '%') return `${value.toFixed(1)}%`
    if (unit === 'GB' || unit === 'MB') return `${value.toFixed(1)} ${unit}`
    return `${value.toFixed(2)} ${unit}`
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Resource Monitoring</h2>
          <p className="text-muted-foreground">Monitor system resources and stack performance</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={summaryLoading || metricsLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${summaryLoading || metricsLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <Activity className="h-4 w-4 mr-2" />
            Auto Refresh
          </Button>
        </div>
      </div>

      {/* Resource Summary Cards */}
      {resourceSummary?.data && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">CPU Usage</CardTitle>
              <Cpu className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatValue((resourceSummary.data.totalCpu.used / resourceSummary.data.totalCpu.limit) * 100, '%')}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Progress value={(resourceSummary.data.totalCpu.used / resourceSummary.data.totalCpu.limit) * 100} className="flex-1" />
                <span className="text-xs text-muted-foreground">
                  / {formatValue(resourceSummary.data.totalCpu.limit, 'cores')}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Memory Usage</CardTitle>
              <MemoryStick className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatValue((resourceSummary.data.totalMemory.used / resourceSummary.data.totalMemory.limit) * 100, '%')}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Progress value={(resourceSummary.data.totalMemory.used / resourceSummary.data.totalMemory.limit) * 100} className="flex-1" />
                <span className="text-xs text-muted-foreground">
                  / {formatValue(resourceSummary.data.totalMemory.limit, 'GB')}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Storage Usage</CardTitle>
              <HardDrive className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatValue((resourceSummary.data.totalStorage.used / resourceSummary.data.totalStorage.limit) * 100, '%')}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Progress value={(resourceSummary.data.totalStorage.used / resourceSummary.data.totalStorage.limit) * 100} className="flex-1" />
                <span className="text-xs text-muted-foreground">
                  / {formatValue(resourceSummary.data.totalStorage.limit, 'GB')}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Resources</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{resourceSummary.data.projectCount}</div>
              <p className="text-xs text-muted-foreground">
                projects • {resourceSummary.data.totalServices} services
              </p>
              <div className="flex items-center gap-2 mt-2">
                <AlertTriangle className="h-3 w-3 text-yellow-500" />
                <span className="text-xs">{resourceAlerts?.data?.length || 0} alerts</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Critical Alerts */}
      {resourceAlerts?.data && resourceAlerts.data.length > 0 && (
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <AlertTitle className="text-red-800">Resource Alerts</AlertTitle>
          <AlertDescription className="text-red-700">
            {resourceAlerts.data.filter((alert) => alert.severity === 'critical').length} critical alerts require immediate attention.
            <Button variant="link" className="p-0 h-auto text-red-700 underline ml-2">
              View all alerts
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4" />
          <span className="text-sm font-medium">Filters:</span>
        </div>
        
        <Select value={selectedTimeRange} onValueChange={(value: '1h' | '6h' | '24h' | '7d') => setSelectedTimeRange(value)}>
          <SelectTrigger className="w-32">
            <Calendar className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1h">Last Hour</SelectItem>
            <SelectItem value="6h">Last 6 Hours</SelectItem>
            <SelectItem value="24h">Last 24 Hours</SelectItem>
            <SelectItem value="7d">Last 7 Days</SelectItem>
          </SelectContent>
        </Select>

        <Select value={selectedStack} onValueChange={setSelectedStack}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Select stack" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stacks</SelectItem>
            {stacks?.data?.map((stack) => (
              <SelectItem key={stack.id} value={stack.id}>
                {stack.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={alertFilter} onValueChange={(value: 'all' | 'warning' | 'critical') => setAlertFilter(value)}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Alerts</SelectItem>
            <SelectItem value="warning">Warnings</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Resource Charts */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="cpu">CPU</TabsTrigger>
          <TabsTrigger value="memory">Memory</TabsTrigger>
          <TabsTrigger value="disk">Disk</TabsTrigger>
          <TabsTrigger value="network">Network</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {filteredResourceData.map((stackData) => (
              <div key={stackData.stackId} className="space-y-4">
                <h3 className="text-lg font-semibold">{stackData.stackName}</h3>
                <div className="grid grid-cols-2 gap-4">
                  <ResourceMetricsChart
                    title="CPU Usage"
                    metrics={stackData.cpuMetrics}
                    metricType="cpu"
                    threshold={80}
                    quota={stackData.cpuQuota}
                    unit="%"
                  />
                  <ResourceMetricsChart
                    title="Memory Usage"
                    metrics={stackData.memoryMetrics}
                    metricType="memory"
                    threshold={85}
                    quota={stackData.memoryQuota}
                    unit="%"
                  />
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="cpu" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredResourceData.map((stackData) => (
              <ResourceMetricsChart
                key={`cpu-${stackData.stackId}`}
                title={`${stackData.stackName} - CPU`}
                metrics={stackData.cpuMetrics}
                metricType="cpu"
                threshold={80}
                quota={stackData.cpuQuota}
                unit="%"
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="memory" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredResourceData.map((stackData) => (
              <ResourceMetricsChart
                key={`memory-${stackData.stackId}`}
                title={`${stackData.stackName} - Memory`}
                metrics={stackData.memoryMetrics}
                metricType="memory"
                threshold={85}
                quota={stackData.memoryQuota}
                unit="%"
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="disk" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredResourceData.map((stackData) => (
              <ResourceMetricsChart
                key={`disk-${stackData.stackId}`}
                title={`${stackData.stackName} - Disk`}
                metrics={stackData.diskMetrics}
                metricType="disk"
                threshold={90}
                quota={stackData.diskQuota}
                unit="%"
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="network" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {filteredResourceData.map((stackData) => (
              <div key={stackData.stackId} className="space-y-4">
                <h3 className="text-lg font-semibold">{stackData.stackName}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <ResourceMetricsChart
                    title="Network In"
                    metrics={stackData.networkInMetrics}
                    metricType="network_in"
                    threshold={80 * 1024 * 1024} // 80 MB/s in bytes
                    unit="B/s"
                  />
                  <ResourceMetricsChart
                    title="Network Out"
                    metrics={stackData.networkOutMetrics}
                    metricType="network_out"
                    threshold={50 * 1024 * 1024} // 50 MB/s in bytes
                    unit="B/s"
                  />
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="alerts" className="space-y-4">
          {alertsLoading ? (
            <div className="text-center py-8">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2" />
              <p>Loading alerts...</p>
            </div>
          ) : resourceAlerts?.data && resourceAlerts.data.length > 0 ? (
            <div className="space-y-4">
              {resourceAlerts.data.map((alert) => (
                <Card key={alert.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className={`h-4 w-4 ${getSeverityColor(alert.severity)}`} />
                        <CardTitle className="text-base">{alert.projectId}</CardTitle>
                        <Badge 
                          variant={alert.severity === 'critical' ? 'destructive' : 'secondary'}
                          className={alert.severity === 'warning' ? 'bg-yellow-100 text-yellow-800' : ''}
                        >
                          {alert.severity}
                        </Badge>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {new Date(alert.timestamp).toLocaleString()}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm mb-2">{alert.message}</p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>Current: {formatValue(alert.currentUsage, alert.resource === 'cpu' || alert.resource === 'memory' || alert.resource === 'storage' ? '%' : 'units')}</span>
                      <span>Threshold: {formatValue(alert.threshold, alert.resource === 'cpu' || alert.resource === 'memory' || alert.resource === 'storage' ? '%' : 'units')}</span>
                      <span>Resource: {alert.resource}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <AlertTriangle className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No alerts found</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}