'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { 
  Terminal,
  Download,
  Pause,
  Play,
  RotateCcw,
  Search,
  Calendar
} from 'lucide-react'
import { Input } from '@repo/ui/components/shadcn/input'
import { useParams } from '@/routes/hooks'
import { DashboardProjectsProjectIdServicesServiceIdTabsLogs } from '@/routes'
import { useDeploymentLogs } from '@/hooks/useDeployments'
import { useDeploymentWebSocket } from '@/hooks/useWebSocket'

export default function ServiceLogsPage() {
  const params = useParams(DashboardProjectsProjectIdServicesServiceIdTabsLogs)
  // Extract params for potential future use
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { projectId, serviceId } = params
  
  const [isStreaming, setIsStreaming] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const limit = 200
  const offset = 0

  // Select the latest deployment for this service by convention via search params or context.
  // For now, support an optional `deploymentId` search param in URL; fallback to empty (no data).
  // TODO: In the future, we could use serviceId to fetch the latest deployment automatically
  const url = new URL(typeof window !== 'undefined' ? window.location.href : 'http://localhost')
  const deploymentId = url.searchParams.get('deploymentId') || ''

  // Historical logs via ORPC
  const { data, isLoading, refetch, isRefetching } = useDeploymentLogs(deploymentId, { limit, offset })

  // Live stream via websocket - only connect if we have a deploymentId and streaming is enabled
  const ws = useDeploymentWebSocket(isStreaming && deploymentId ? deploymentId : undefined)

  // Refetch when socket connects and streaming is active
  useEffect(() => {
    if (ws.isConnected && isStreaming && deploymentId) {
      refetch()
    }
  }, [ws.isConnected, isStreaming, deploymentId, refetch])

  const getLevelBadge = (level: string) => {
    switch (level) {
      case 'error': return 'destructive'
      case 'warn': return 'secondary'
      case 'info': return 'default'
      case 'debug': return 'outline'
      default: return 'outline'
    }
  }

  const logs = data?.logs ?? []
  const filteredLogs = useMemo(() => {
    if (!searchQuery) return logs
    const q = searchQuery.toLowerCase()
    return logs.filter(log =>
      log.message.toLowerCase().includes(q) ||
      (log.service ?? '').toLowerCase().includes(q) ||
      (log.stage ?? '').toLowerCase().includes(q)
    )
  }, [logs, searchQuery])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            Service Logs
          </h3>
          <p className="text-sm text-muted-foreground">
            Real-time and historical logs for this service
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsStreaming(!isStreaming)}
          >
            {isStreaming ? (
              <>
                <Pause className="h-4 w-4 mr-2" />
                Pause Stream
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Resume Stream
              </>
            )}
          </Button>
          <Button variant="outline" size="sm">
            <RotateCcw className="h-4 w-4 mr-2" />
            Clear
          </Button>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button variant="outline" size="sm">
          <Calendar className="h-4 w-4 mr-2" />
          Date Range
        </Button>
        <Badge variant={isStreaming ? 'default' : 'secondary'}>
          {isStreaming ? 'Live' : 'Paused'}
        </Badge>
      </div>

      {/* Logs Display */}
      <Card>
        <CardHeader>
          <CardTitle>Application Logs</CardTitle>
          <CardDescription>
            {filteredLogs.length} log entries
            {searchQuery && ` matching "${searchQuery}"`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 font-mono text-sm max-h-96 overflow-y-auto bg-black text-green-400 p-4 rounded">
            {(isLoading || isRefetching) && (
              <div className="text-center py-8 text-muted-foreground">Loading logs…</div>
            )}
            {!isLoading && filteredLogs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {searchQuery ? (
                  <>No logs found matching &quot;{searchQuery}&quot;</>
                ) : (
                  <>No logs available</>
                )}
              </div>
            ) : (
              filteredLogs.map((log, index) => (
                <div key={index} className="flex items-start gap-3 hover:bg-gray-900 p-1 rounded">
                  <span className="text-gray-400 whitespace-nowrap">
                    [{new Date(log.timestamp).toLocaleTimeString()}]
                  </span>
                  <Badge 
                    variant={getLevelBadge(log.level)}
                    className="text-xs min-w-14 justify-center"
                  >
                    {log.level.toUpperCase()}
                  </Badge>
                  <span className="text-blue-300 min-w-16">
                    [{log.service ?? 'app'}]
                  </span>
                  <span className="flex-1">
                    {log.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Log Statistics */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Entries</CardTitle>
            <Terminal className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{logs.length}</div>
            <p className="text-xs text-muted-foreground">
              Last 1 hour
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Errors</CardTitle>
            <Terminal className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {logs.filter(l => l.level === 'error').length}
            </div>
            <p className="text-xs text-muted-foreground">
              Error entries
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Warnings</CardTitle>
            <Terminal className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {logs.filter(l => l.level === 'warn').length}
            </div>
            <p className="text-xs text-muted-foreground">
              Warning entries
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Info</CardTitle>
            <Terminal className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {logs.filter(l => l.level === 'info').length}
            </div>
            <p className="text-xs text-muted-foreground">
              Info entries
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}