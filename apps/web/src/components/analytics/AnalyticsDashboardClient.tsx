'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { Button } from '@repo/ui/components/shadcn/button'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { 
  BarChart3, 
  Activity,
  Database,
  Users,
  HardDrive,
  Clock,
  TrendingUp,
  Server,
  Download,
  FileText,
  Plus
} from 'lucide-react'
import { orpc } from '@/lib/orpc'

export default function AnalyticsDashboardClient() {
  const [activeTab, setActiveTab] = useState('metrics')
  const [timeRange, setTimeRange] = useState('24h')
  const [metricType, setMetricType] = useState('resource')

  // Resource Metrics
  const { data: resourceMetrics, isLoading: resourceMetricsLoading } = useQuery(
    orpc.analytics.getResourceMetrics.queryOptions({
      input: {
        timeRange: timeRange as '1h' | '1d' | '7d' | '30d',
        granularity: 'hour',
      },
      staleTime: 60000, // 1 minute
    })
  )

  // Application Metrics
  const { data: applicationMetrics, isLoading: applicationMetricsLoading } = useQuery(
    orpc.analytics.getApplicationMetrics.queryOptions({
      input: {
        timeRange: timeRange as '1h' | '1d' | '7d' | '30d',
        granularity: 'hour',
      },
      staleTime: 60000, // 1 minute
    })
  )

  // Database Metrics
  const { data: databaseMetrics, isLoading: databaseMetricsLoading } = useQuery(
    orpc.analytics.getDatabaseMetrics.queryOptions({
      input: {
        timeRange: timeRange as '1h' | '1d' | '7d' | '30d',
        granularity: 'hour',
      },
      staleTime: 60000, // 1 minute
    })
  )

  // Deployment Metrics
  const { data: deploymentMetrics, isLoading: deploymentMetricsLoading } = useQuery(
    orpc.analytics.getDeploymentMetrics.queryOptions({
      input: {
        timeRange: timeRange as '1h' | '1d' | '7d' | '30d',
        granularity: 'hour',
      },
      staleTime: 60000, // 1 minute
    })
  )

  // User Activity
  const { data: userActivity, isLoading: userActivityLoading } = useQuery(
    orpc.analytics.getUserActivity.queryOptions({
      input: {
        timeRange: timeRange as '1h' | '1d' | '7d' | '30d',
      },
      staleTime: 60000, // 1 minute
    })
  )

  // Activity Summary
  const { data: activitySummary, isLoading: activitySummaryLoading } = useQuery(
    orpc.analytics.getActivitySummary.queryOptions({
      input: {
        timeRange: timeRange as '1h' | '1d' | '7d' | '30d',
      },
      staleTime: 60000, // 1 minute
    })
  )

  // API Usage
  const { data: apiUsage, isLoading: apiUsageLoading } = useQuery(
    orpc.analytics.getApiUsage.queryOptions({
      input: {
        timeRange: timeRange as '1h' | '1d' | '7d' | '30d',
      },
      staleTime: 60000, // 1 minute
    })
  )

  // Deployment Usage
  const { data: deploymentUsage, isLoading: deploymentUsageLoading } = useQuery(
    orpc.analytics.getDeploymentUsage.queryOptions({
      input: {
        timeRange: timeRange as '1d' | '7d' | '30d',
      },
      staleTime: 60000, // 1 minute
    })
  )

  // Storage Usage
  const { data: storageUsage } = useQuery(
    orpc.analytics.getStorageUsage.queryOptions({
      input: {
        timeRange: timeRange as '1d' | '7d' | '30d',
      },
      staleTime: 60000, // 1 minute
    })
  )

  // Reports List
  const { data: reports = [], isLoading: reportsLoading } = useQuery(
    orpc.analytics.listReports.queryOptions({
      input: {
        limit: 20,
        offset: 0,
      },
      staleTime: 60000, // 1 minute
    })
  )

  const formatBytes = (bytes: number) => {
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    if (bytes === 0) return '0 B'
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i]
  }

  const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`

  return (
    <div className="container mx-auto py-6 px-4 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-2 rounded-lg">
              <BarChart3 className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Analytics Dashboard
              </h1>
              <p className="text-gray-600">
                Monitor platform usage, performance metrics, and system insights
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">Last Hour</SelectItem>
                <SelectItem value="24h">Last 24h</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Server className="h-8 w-8 text-blue-600" />
                <div>
                  <p className="text-sm text-gray-600">CPU Usage</p>
                  <p className="text-2xl font-bold">
                    {resourceMetrics?.data?.length ? formatPercent(resourceMetrics.data[resourceMetrics.data.length - 1].cpu.usage) : '-%'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Database className="h-8 w-8 text-green-600" />
                <div>
                  <p className="text-sm text-gray-600">Memory Usage</p>
                  <p className="text-2xl font-bold">
                    {resourceMetrics?.data?.length ? formatPercent(resourceMetrics.data[resourceMetrics.data.length - 1].memory.percentage) : '-%'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <HardDrive className="h-8 w-8 text-purple-600" />
                <div>
                  <p className="text-sm text-gray-600">Storage Used</p>
                  <p className="text-2xl font-bold">
                    {storageUsage?.total?.used ? formatBytes(storageUsage.total.used) : '-'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Users className="h-8 w-8 text-orange-600" />
                <div>
                  <p className="text-sm text-gray-600">Active Users</p>
                  <p className="text-2xl font-bold">
                    {userActivity?.total || '-'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="metrics" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Metrics
          </TabsTrigger>
          <TabsTrigger value="usage" className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Usage
          </TabsTrigger>
          <TabsTrigger value="performance" className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Performance
          </TabsTrigger>
          <TabsTrigger value="reports" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Reports
          </TabsTrigger>
        </TabsList>

        {/* Metrics Tab */}
        <TabsContent value="metrics" className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">System Metrics</h2>
            <Select value={metricType} onValueChange={setMetricType}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="resource">Resource</SelectItem>
                <SelectItem value="application">Application</SelectItem>
                <SelectItem value="database">Database</SelectItem>
                <SelectItem value="deployment">Deployment</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-6">
            {/* Resource Metrics */}
            {metricType === 'resource' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Server className="h-5 w-5" />
                      CPU Usage
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {resourceMetricsLoading ? (
                      <div className="text-center py-4">Loading...</div>
                    ) : resourceMetrics?.data?.length ? (
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span>Current:</span>
                          <span className="font-semibold">{formatPercent(resourceMetrics.data[resourceMetrics.data.length - 1].cpu.usage)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Average:</span>
                          <span>{formatPercent(resourceMetrics.data.reduce((sum, d) => sum + d.cpu.usage, 0) / resourceMetrics.data.length)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Peak:</span>
                          <span>{formatPercent(Math.max(...resourceMetrics.data.map(d => d.cpu.usage)))}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center text-gray-500 py-4">No data available</div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Database className="h-5 w-5" />
                      Memory Usage
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {resourceMetricsLoading ? (
                      <div className="text-center py-4">Loading...</div>
                    ) : resourceMetrics?.data?.length ? (
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span>Current:</span>
                          <span className="font-semibold">{formatPercent(resourceMetrics.data[resourceMetrics.data.length - 1].memory.percentage)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Average:</span>
                          <span>{formatPercent(resourceMetrics.data.reduce((sum, d) => sum + d.memory.percentage, 0) / resourceMetrics.data.length)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Peak:</span>
                          <span>{formatPercent(Math.max(...resourceMetrics.data.map(d => d.memory.percentage)))}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center text-gray-500 py-4">No data available</div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Application Metrics */}
            {metricType === 'application' && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    Application Performance
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {applicationMetricsLoading ? (
                    <div className="text-center py-4">Loading...</div>
                  ) : applicationMetrics ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">
                          {applicationMetrics?.data?.length ? applicationMetrics.data[applicationMetrics.data.length - 1].throughput || 0 : 0}
                        </div>
                        <div className="text-sm text-gray-600">Requests/sec</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-600">
                          {applicationMetrics?.data?.length ? applicationMetrics.data[applicationMetrics.data.length - 1].responseTime.average || 0 : 0}ms
                        </div>
                        <div className="text-sm text-gray-600">Avg Response Time</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-purple-600">
                          {applicationMetrics?.data?.length && applicationMetrics.data[applicationMetrics.data.length - 1].errorRate ? formatPercent(applicationMetrics.data[applicationMetrics.data.length - 1].errorRate) : '0%'}
                        </div>
                        <div className="text-sm text-gray-600">Error Rate</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center text-gray-500 py-4">No data available</div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Database Metrics */}
            {metricType === 'database' && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="h-5 w-5" />
                    Database Performance
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {databaseMetricsLoading ? (
                    <div className="text-center py-4">Loading...</div>
                  ) : databaseMetrics ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">
                          {databaseMetrics?.data?.length ? databaseMetrics.data[databaseMetrics.data.length - 1].connections.active || 0 : 0}
                        </div>
                        <div className="text-sm text-gray-600">Active Connections</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-600">
                          {databaseMetrics?.data?.length ? databaseMetrics.data[databaseMetrics.data.length - 1].queries.total || 0 : 0}
                        </div>
                        <div className="text-sm text-gray-600">Queries/sec</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-purple-600">
                          {databaseMetrics?.data?.length ? databaseMetrics.data[databaseMetrics.data.length - 1].performance.averageQueryTime || 0 : 0}ms
                        </div>
                        <div className="text-sm text-gray-600">Avg Query Time</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center text-gray-500 py-4">No data available</div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Deployment Metrics */}
            {metricType === 'deployment' && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Deployment Statistics
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {deploymentMetricsLoading ? (
                    <div className="text-center py-4">Loading...</div>
                  ) : deploymentMetrics ? (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">
                          {deploymentMetrics?.data?.length ? deploymentMetrics.data.reduce((sum, d) => sum + d.deploymentsCount, 0) : 0}
                        </div>
                        <div className="text-sm text-gray-600">Total Deployments</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-600">
                          {deploymentMetrics?.data?.length ? Math.round(deploymentMetrics.data.reduce((sum, d) => sum + (d.deploymentsCount * d.successRate / 100), 0)) : 0}
                        </div>
                        <div className="text-sm text-gray-600">Successful</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-red-600">
                          {deploymentMetrics?.data?.length ? deploymentMetrics.data.reduce((sum, d) => sum + d.rollbackCount, 0) : 0}
                        </div>
                        <div className="text-sm text-gray-600">Failed</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-purple-600">
                          {deploymentMetrics?.data?.length ? Math.round(deploymentMetrics.data.reduce((sum, d) => sum + d.averageDeployTime, 0) / deploymentMetrics.data.length) : 0}s
                        </div>
                        <div className="text-sm text-gray-600">Avg Deploy Time</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center text-gray-500 py-4">No data available</div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Usage Tab */}
        <TabsContent value="usage" className="space-y-6">
          <h2 className="text-xl font-semibold">Usage Analytics</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* User Activity */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  User Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                {userActivityLoading ? (
                  <div className="text-center py-4">Loading...</div>
                ) : userActivity ? (
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span>Active Users:</span>
                      <Badge>{userActivity.data?.length || 0}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Total Sessions:</span>
                      <Badge variant="secondary">{userActivity.data?.length || 0}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Avg Session Duration:</span>
                      <Badge variant="outline">-</Badge>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-gray-500 py-4">No data available</div>
                )}
              </CardContent>
            </Card>

            {/* API Usage */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  API Usage
                </CardTitle>
              </CardHeader>
              <CardContent>
                {apiUsageLoading ? (
                  <div className="text-center py-4">Loading...</div>
                ) : apiUsage ? (
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span>Total Requests:</span>
                      <Badge>{apiUsage.total?.requests || 0}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Success Rate:</span>
                      <Badge variant="secondary">{formatPercent(apiUsage.total?.requests ? ((apiUsage.total.requests - apiUsage.total.errors) / apiUsage.total.requests) : 0)}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Avg Response Time:</span>
                      <Badge variant="outline">{apiUsage.data?.[0]?.averageResponseTime || 0}ms</Badge>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-gray-500 py-4">No data available</div>
                )}
              </CardContent>
            </Card>

            {/* Storage Usage */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HardDrive className="h-5 w-5" />
                  Storage Usage
                </CardTitle>
              </CardHeader>
              <CardContent>
                {storageUsage ? (
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span>Total Used:</span>
                      <Badge>{formatBytes(storageUsage.total?.used || 0)}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Available:</span>
                      <Badge variant="secondary">{formatBytes(storageUsage.total?.available || 0)}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Usage:</span>
                      <Badge variant="outline">{formatPercent(storageUsage.total?.used && storageUsage.total?.allocated ? (storageUsage.total.used / storageUsage.total.allocated) : 0)}</Badge>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-gray-500 py-4">No data available</div>
                )}
              </CardContent>
            </Card>

            {/* Deployment Usage */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Deployment Usage
                </CardTitle>
              </CardHeader>
              <CardContent>
                {deploymentUsageLoading ? (
                  <div className="text-center py-4">Loading...</div>
                ) : deploymentUsage ? (
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span>Deployments Today:</span>
                      <Badge>{deploymentUsage.data?.filter(d => {
                        const today = new Date();
                        const deployDate = new Date(d.date);
                        return deployDate.toDateString() === today.toDateString();
                      }).reduce((sum, d) => sum + d.deployments, 0) || 0}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>This Week:</span>
                      <Badge variant="secondary">{deploymentUsage.summary?.totalDeployments || 0}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Success Rate:</span>
                      <Badge variant="outline">{formatPercent(deploymentUsage.summary?.successRate || 0)}</Badge>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-gray-500 py-4">No data available</div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Performance Tab */}
        <TabsContent value="performance" className="space-y-6">
          <h2 className="text-xl font-semibold">Performance Analysis</h2>
          
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Activity Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activitySummaryLoading ? (
                <div className="text-center py-4">Loading...</div>
              ) : activitySummary ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="text-center p-4 bg-blue-50 rounded-lg">
                    <div className="text-2xl font-bold text-blue-600">
                      {activitySummary.data?.reduce((sum, period) => sum + period.totalActions, 0) || 0}
                    </div>
                    <div className="text-sm text-gray-600">Total Activities</div>
                  </div>
                  <div className="text-center p-4 bg-green-50 rounded-lg">
                    <div className="text-2xl font-bold text-green-600">
                      {activitySummary.data?.reduce((sum, period) => sum + period.uniqueUsers, 0) || 0}
                    </div>
                    <div className="text-sm text-gray-600">Unique Users</div>
                  </div>
                  <div className="text-center p-4 bg-purple-50 rounded-lg">
                    <div className="text-2xl font-bold text-purple-600">
                      -
                    </div>
                    <div className="text-sm text-gray-600">Peak Hour</div>
                  </div>
                  <div className="text-center p-4 bg-orange-50 rounded-lg">
                    <div className="text-2xl font-bold text-orange-600">
                      {formatPercent(0)}
                    </div>
                    <div className="text-sm text-gray-600">Growth Rate</div>
                  </div>
                </div>
              ) : (
                <div className="text-center text-gray-500 py-4">No data available</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Reports Tab */}
        <TabsContent value="reports" className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Analytics Reports</h2>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Generate Report
            </Button>
          </div>

          <div className="grid gap-4">
            {reportsLoading ? (
              <div className="text-center py-8">Loading reports...</div>
            ) : (Array.isArray(reports) ? reports : reports?.data || []).length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <FileText className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                  <h3 className="text-lg font-semibold mb-2">No Reports Available</h3>
                  <p className="text-gray-600 mb-4">Generate your first analytics report to get started</p>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Generate Report
                  </Button>
                </CardContent>
              </Card>
            ) : (
              (Array.isArray(reports) ? reports : reports?.data || []).map((report: { id: string; name: string; description?: string; format: string; status?: string; generatedAt?: Date }) => (
                <Card key={report.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5 text-blue-600" />
                        <div>
                          <h3 className="font-semibold">{report.name}</h3>
                          <p className="text-sm text-gray-600">
                            {report.description || 'No description available'}
                          </p>
                          <p className="text-sm text-gray-500">
                            Created: {report.generatedAt ? new Date(report.generatedAt).toLocaleDateString() : 'N/A'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={report.status === 'completed' ? 'default' : 'secondary'}>
                          {report.status || 'unknown'}
                        </Badge>
                        <Button size="sm" variant="outline">
                          <Download className="h-4 w-4 mr-2" />
                          Download
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}