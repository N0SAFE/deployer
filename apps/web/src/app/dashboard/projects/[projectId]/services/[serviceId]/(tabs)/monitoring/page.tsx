'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { 
  Activity,
  BarChart3,
  Network,
  Clock,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Zap,
  HardDrive,
  Cpu
} from 'lucide-react'
import ResourceMetricsChart from '@/components/orchestration/ResourceMetricsChart'

export default function ServiceMonitoringPage() {
  // Mock monitoring data
  const metrics = {
    cpu: {
      current: 25,
      average: 18,
      peak: 45,
      trend: 'up'
    },
    memory: {
      current: 256,
      total: 512,
      average: 180,
      trend: 'stable'
    },
    network: {
      inbound: 1.2,
      outbound: 2.8,
      total: 4.0,
      trend: 'up'
    },
    uptime: {
      percentage: 99.9,
      duration: '23d 14h 32m',
      lastIncident: new Date('2024-01-01T10:30:00Z')
    }
  }

  const alerts = [
    {
      id: 1,
      type: 'warning',
      message: 'CPU usage above 80% for 5 minutes',
      timestamp: new Date('2024-01-15T10:25:00Z'),
      resolved: false
    },
    {
      id: 2,
      type: 'info',
      message: 'Memory usage returned to normal',
      timestamp: new Date('2024-01-15T09:15:00Z'),
      resolved: true
    }
  ]

  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'error': return <AlertTriangle className="h-4 w-4 text-red-500" />
      case 'warning': return <AlertTriangle className="h-4 w-4 text-yellow-500" />
      default: return <AlertTriangle className="h-4 w-4 text-blue-500" />
    }
  }

  const getAlertBadge = (type: string) => {
    switch (type) {
      case 'error': return 'destructive'
      case 'warning': return 'secondary'
      default: return 'default'
    }
  }

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'up': return <TrendingUp className="h-4 w-4 text-red-500" />
      case 'down': return <TrendingDown className="h-4 w-4 text-green-500" />
      default: return <Activity className="h-4 w-4 text-gray-500" />
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Performance Monitoring</h3>
          <p className="text-sm text-muted-foreground">
            Real-time performance metrics and resource usage
          </p>
        </div>
        <Button variant="outline">
          <BarChart3 className="h-4 w-4 mr-2" />
          View Dashboard
        </Button>
      </div>

      {/* Current Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">CPU Usage</CardTitle>
            <div className="flex items-center gap-1">
              <Cpu className="h-4 w-4 text-muted-foreground" />
              {getTrendIcon(metrics.cpu.trend)}
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.cpu.current}%</div>
            <p className="text-xs text-muted-foreground">
              Avg: {metrics.cpu.average}% | Peak: {metrics.cpu.peak}%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Memory Usage</CardTitle>
            <div className="flex items-center gap-1">
              <HardDrive className="h-4 w-4 text-muted-foreground" />
              {getTrendIcon(metrics.memory.trend)}
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.memory.current} MB</div>
            <p className="text-xs text-muted-foreground">
              of {metrics.memory.total} MB allocated
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Network I/O</CardTitle>
            <div className="flex items-center gap-1">
              <Network className="h-4 w-4 text-muted-foreground" />
              {getTrendIcon(metrics.network.trend)}
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.network.total} MB</div>
            <p className="text-xs text-muted-foreground">
              In: {metrics.network.inbound} MB | Out: {metrics.network.outbound} MB
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Uptime</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.uptime.percentage}%</div>
            <p className="text-xs text-muted-foreground">
              {metrics.uptime.duration}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Performance Charts */}
      <Card>
        <CardHeader>
          <CardTitle>Performance Charts</CardTitle>
          <CardDescription>
            Historical performance metrics over time
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2">
            {/* CPU Usage Chart */}
            <ResourceMetricsChart
              title="CPU Usage"
              metricType="cpu"
              metrics={[
                { id: '1', stackId: 'service-stack', metricType: 'cpu', value: 20, unit: '%', timestamp: new Date(Date.now() - 60000 * 60), threshold: 80 },
                { id: '2', stackId: 'service-stack', metricType: 'cpu', value: 25, unit: '%', timestamp: new Date(Date.now() - 60000 * 45), threshold: 80 },
                { id: '3', stackId: 'service-stack', metricType: 'cpu', value: 35, unit: '%', timestamp: new Date(Date.now() - 60000 * 30), threshold: 80 },
                { id: '4', stackId: 'service-stack', metricType: 'cpu', value: 28, unit: '%', timestamp: new Date(Date.now() - 60000 * 15), threshold: 80 },
                { id: '5', stackId: 'service-stack', metricType: 'cpu', value: 22, unit: '%', timestamp: new Date(), threshold: 80 }
              ]}
              threshold={80}
              quota={30}
              unit="%"
            />

            {/* Memory Usage Chart */}
            <ResourceMetricsChart
              title="Memory Usage"
              metricType="memory"
              metrics={[
                { id: '1', stackId: 'service-stack', metricType: 'memory', value: 180, unit: 'MB', timestamp: new Date(Date.now() - 60000 * 60), threshold: 400 },
                { id: '2', stackId: 'service-stack', metricType: 'memory', value: 210, unit: 'MB', timestamp: new Date(Date.now() - 60000 * 45), threshold: 400 },
                { id: '3', stackId: 'service-stack', metricType: 'memory', value: 256, unit: 'MB', timestamp: new Date(Date.now() - 60000 * 30), threshold: 400 },
                { id: '4', stackId: 'service-stack', metricType: 'memory', value: 240, unit: 'MB', timestamp: new Date(Date.now() - 60000 * 15), threshold: 400 },
                { id: '5', stackId: 'service-stack', metricType: 'memory', value: 220, unit: 'MB', timestamp: new Date(), threshold: 400 }
              ]}
              threshold={400}
              quota={512}
              unit="MB"
            />

            {/* Network I/O Chart */}
            <ResourceMetricsChart
              title="Network In"
              metricType="network_in"
              metrics={[
                { id: '1', stackId: 'service-stack', metricType: 'network_in', value: 0.8, unit: 'MB/s', timestamp: new Date(Date.now() - 60000 * 60), threshold: 4 },
                { id: '2', stackId: 'service-stack', metricType: 'network_in', value: 1.2, unit: 'MB/s', timestamp: new Date(Date.now() - 60000 * 45), threshold: 4 },
                { id: '3', stackId: 'service-stack', metricType: 'network_in', value: 1.5, unit: 'MB/s', timestamp: new Date(Date.now() - 60000 * 30), threshold: 4 },
                { id: '4', stackId: 'service-stack', metricType: 'network_in', value: 1.1, unit: 'MB/s', timestamp: new Date(Date.now() - 60000 * 15), threshold: 4 },
                { id: '5', stackId: 'service-stack', metricType: 'network_in', value: 0.9, unit: 'MB/s', timestamp: new Date(), threshold: 4 }
              ]}
              threshold={4}
              quota={5}
              unit="MB/s"
            />

            {/* Network Out Chart */}
            <ResourceMetricsChart
              title="Network Out"
              metricType="network_out"
              metrics={[
                { id: '1', stackId: 'service-stack', metricType: 'network_out', value: 2.1, unit: 'MB/s', timestamp: new Date(Date.now() - 60000 * 60), threshold: 4 },
                { id: '2', stackId: 'service-stack', metricType: 'network_out', value: 2.8, unit: 'MB/s', timestamp: new Date(Date.now() - 60000 * 45), threshold: 4 },
                { id: '3', stackId: 'service-stack', metricType: 'network_out', value: 3.2, unit: 'MB/s', timestamp: new Date(Date.now() - 60000 * 30), threshold: 4 },
                { id: '4', stackId: 'service-stack', metricType: 'network_out', value: 2.5, unit: 'MB/s', timestamp: new Date(Date.now() - 60000 * 15), threshold: 4 },
                { id: '5', stackId: 'service-stack', metricType: 'network_out', value: 2.3, unit: 'MB/s', timestamp: new Date(), threshold: 4 }
              ]}
              threshold={4}
              quota={5}
              unit="MB/s"
            />
          </div>
        </CardContent>
      </Card>

      {/* Alerts & Incidents */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Alerts</CardTitle>
          <CardDescription>
            Recent alerts and performance incidents
          </CardDescription>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <div className="text-center py-8">
              <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No active alerts</h3>
              <p className="text-muted-foreground">
                All systems are running normally
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    {getAlertIcon(alert.type)}
                    <div>
                      <p className="text-sm font-medium">{alert.message}</p>
                      <p className="text-xs text-muted-foreground">
                        {alert.timestamp.toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={getAlertBadge(alert.type)}>
                      {alert.type}
                    </Badge>
                    {alert.resolved && (
                      <Badge variant="outline">
                        Resolved
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Health Check Status */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Health Checks</CardTitle>
            <CardDescription>Service health check status</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Application Health</span>
                <Badge variant="default">Healthy</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Database Connection</span>
                <Badge variant="default">Healthy</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">External APIs</span>
                <Badge variant="secondary">Warning</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>SLA Status</CardTitle>
            <CardDescription>Service level agreement metrics</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Uptime SLA (99.9%)</span>
                <Badge variant="default">
                  <Zap className="h-3 w-3 mr-1" />
                  Met
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Response Time (&lt;200ms)</span>
                <Badge variant="default">
                  <Zap className="h-3 w-3 mr-1" />
                  Met
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Error Rate (&lt;1%)</span>
                <Badge variant="default">
                  <Zap className="h-3 w-3 mr-1" />
                  Met
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}