'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Progress } from '@repo/ui/components/shadcn/progress'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@repo/ui/components/shadcn/tooltip'
import { 
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Info,
  Activity
} from 'lucide-react'

interface ResourceMetric {
  id: string
  stackId: string
  metricType: 'cpu' | 'memory' | 'disk' | 'network_in' | 'network_out'
  value: number
  unit: string
  timestamp: Date
  threshold?: number
}

interface ResourceMetricsChartProps {
  title: string
  metrics: ResourceMetric[]
  metricType: 'cpu' | 'memory' | 'disk' | 'network_in' | 'network_out'
  threshold?: number
  quota?: number
  unit?: string
}

export default function ResourceMetricsChart({ 
  title, 
  metrics, 
  metricType, 
  threshold = 80, 
  quota,
  unit = '%'
}: ResourceMetricsChartProps) {
  // Get the latest metric value
  const latestMetric = useMemo(() => {
    const filteredMetrics = metrics.filter(m => m.metricType === metricType)
    return filteredMetrics.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0]
  }, [metrics, metricType])

  // Calculate trend over last few data points
  const trend = useMemo(() => {
    const filteredMetrics = metrics
      .filter(m => m.metricType === metricType)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 5) // Last 5 data points

    if (filteredMetrics.length < 2) return 'stable'

    const recent = filteredMetrics.slice(0, 3).reduce((sum, m) => sum + m.value, 0) / 3
    const older = filteredMetrics.slice(2, 5).reduce((sum, m) => sum + m.value, 0) / Math.max(1, filteredMetrics.slice(2, 5).length)

    const change = recent - older
    const changePercent = Math.abs(change / older) * 100

    if (changePercent < 5) return 'stable'
    return change > 0 ? 'increasing' : 'decreasing'
  }, [metrics, metricType])

  const getIcon = () => {
    switch (metricType) {
      case 'cpu':
        return <Cpu className="h-5 w-5" />
      case 'memory':
        return <MemoryStick className="h-5 w-5" />
      case 'disk':
        return <HardDrive className="h-5 w-5" />
      case 'network_in':
      case 'network_out':
        return <Network className="h-5 w-5" />
      default:
        return <Activity className="h-5 w-5" />
    }
  }

  const getTrendIcon = () => {
    switch (trend) {
      case 'increasing':
        return <TrendingUp className="h-4 w-4 text-red-600" />
      case 'decreasing':
        return <TrendingDown className="h-4 w-4 text-green-600" />
      default:
        return <Activity className="h-4 w-4 text-gray-600" />
    }
  }

  const getStatusBadge = () => {
    if (!latestMetric) return <Badge variant="outline">No Data</Badge>
    
    const value = latestMetric.value
    if (value >= threshold) return <Badge variant="destructive">Critical</Badge>
    if (value >= threshold * 0.7) return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">Warning</Badge>
    return <Badge variant="default" className="bg-green-100 text-green-800">Normal</Badge>
  }

  const formatValue = (value: number) => {
    switch (metricType) {
      case 'cpu':
      case 'memory':
      case 'disk':
        return `${value.toFixed(1)}${unit}`
      case 'network_in':
      case 'network_out':
        if (value >= 1024 * 1024 * 1024) {
          return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB/s`
        } else if (value >= 1024 * 1024) {
          return `${(value / (1024 * 1024)).toFixed(1)} MB/s`
        } else if (value >= 1024) {
          return `${(value / 1024).toFixed(1)} KB/s`
        }
        return `${value.toFixed(1)} B/s`
      default:
        return `${value.toFixed(1)}${unit}`
    }
  }

  const progressValue = latestMetric ? Math.min(latestMetric.value, 100) : 0

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getIcon()}
            <CardTitle className="text-base font-medium">{title}</CardTitle>
            {getStatusBadge()}
          </div>
          
          <div className="flex items-center gap-2">
            {getTrendIcon()}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-gray-400" />
                </TooltipTrigger>
                <TooltipContent>
                  <div className="text-sm">
                    <p><strong>Current:</strong> {latestMetric ? formatValue(latestMetric.value) : 'No data'}</p>
                    <p><strong>Threshold:</strong> {threshold}%</p>
                    <p><strong>Trend:</strong> {trend}</p>
                    {quota && <p><strong>Quota:</strong> {quota}{unit}</p>}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="space-y-4">
          {/* Current Value Display */}
          <div className="text-center">
            <div className="text-3xl font-bold text-gray-900">
              {latestMetric ? formatValue(latestMetric.value) : '--'}
            </div>
            <p className="text-sm text-gray-600">Current Usage</p>
          </div>

          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-gray-600">
              <span>Usage</span>
              <span>{progressValue.toFixed(1)}%</span>
            </div>
            <Progress 
              value={progressValue} 
              className="h-2"
            />
            
            {/* Threshold indicator */}
            <div className="relative">
              <div 
                className="absolute w-0.5 h-2 bg-red-400"
                style={{ left: `${threshold}%` }}
              />
              <div className="text-xs text-gray-500 mt-1">
                Threshold: {threshold}%
              </div>
            </div>
          </div>

          {/* Quota Comparison (if available) */}
          {quota && (
            <div className="bg-gray-50 p-3 rounded-lg">
              <h4 className="font-medium text-sm mb-2">Quota Status</h4>
              <div className="flex justify-between items-center">
                <div className="text-sm">
                  <p className="text-gray-600">Used: <span className="font-medium">{latestMetric ? formatValue(latestMetric.value) : '--'}</span></p>
                  <p className="text-gray-600">Quota: <span className="font-medium">{quota}{unit}</span></p>
                </div>
                {latestMetric && (
                  <div className="text-right">
                    <p className="text-lg font-bold">
                      {((latestMetric.value / quota) * 100).toFixed(1)}%
                    </p>
                    <p className="text-xs text-gray-500">of quota</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Alert Section */}
          {latestMetric && latestMetric.value >= threshold && (
            <div className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <div className="text-sm">
                <p className="font-medium text-red-800">Resource Alert</p>
                <p className="text-red-600">
                  {title} usage ({formatValue(latestMetric.value)}) exceeds threshold ({threshold}%)
                </p>
              </div>
            </div>
          )}

          {/* Last Updated */}
          {latestMetric && (
            <div className="text-xs text-gray-500 text-center">
              Last updated: {new Date(latestMetric.timestamp).toLocaleString()}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}