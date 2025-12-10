'use client'

import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@repo/ui/components/shadcn/chart'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import { useState } from 'react'

// Mock data for deployment trends - last 7 days
const generateMockDeploymentData = () => {
  const data = []
  const now = new Date()
  
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now)
    date.setDate(date.getDate() - i)
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short' })
    
    // Generate realistic-looking deployment counts
    const baseSuccessful = Math.floor(Math.random() * 15) + 5
    const baseFailed = Math.floor(Math.random() * 4)
    const baseBuilding = i === 0 ? Math.floor(Math.random() * 3) : 0
    
    data.push({
      date: dayName,
      fullDate: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      successful: baseSuccessful,
      failed: baseFailed,
      building: baseBuilding,
      total: baseSuccessful + baseFailed + baseBuilding,
    })
  }
  
  return data
}

// Mock data for deployments by environment
const generateEnvironmentData = () => [
  { environment: 'Production', deployments: 45, successful: 42, failed: 3 },
  { environment: 'Staging', deployments: 78, successful: 71, failed: 7 },
  { environment: 'Development', deployments: 124, successful: 118, failed: 6 },
]

const trendChartConfig: ChartConfig = {
  successful: {
    label: 'Successful',
    color: 'hsl(142, 76%, 36%)', // green
  },
  failed: {
    label: 'Failed',
    color: 'hsl(0, 84%, 60%)', // red
  },
  building: {
    label: 'Building',
    color: 'hsl(217, 91%, 60%)', // blue
  },
}

const envChartConfig: ChartConfig = {
  successful: {
    label: 'Successful',
    color: 'hsl(142, 76%, 36%)', // green
  },
  failed: {
    label: 'Failed',
    color: 'hsl(0, 84%, 60%)', // red
  },
}

interface DeploymentTrendChartProps {
  isLoading?: boolean
}

export function DeploymentTrendChart({ isLoading = false }: DeploymentTrendChartProps) {
  const [chartType, setChartType] = useState<'area' | 'bar'>('area')
  const data = useMemo(() => generateMockDeploymentData(), [])

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[250px] w-full" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle>Deployment Trends</CardTitle>
          <CardDescription>Daily deployment activity over the last 7 days</CardDescription>
        </div>
        <Select value={chartType} onValueChange={(v) => { setChartType(v as 'area' | 'bar') }}>
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="area">Area</SelectItem>
            <SelectItem value="bar">Bar</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        <ChartContainer config={trendChartConfig} className="h-[250px] w-full">
          {chartType === 'area' ? (
            <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={30}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) => {
                      const item = payload[0]?.payload as { fullDate?: string } | undefined
                      return item?.fullDate ?? ''
                    }}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Area
                type="monotone"
                dataKey="successful"
                stackId="1"
                stroke="var(--color-successful)"
                fill="var(--color-successful)"
                fillOpacity={0.6}
              />
              <Area
                type="monotone"
                dataKey="failed"
                stackId="1"
                stroke="var(--color-failed)"
                fill="var(--color-failed)"
                fillOpacity={0.6}
              />
              <Area
                type="monotone"
                dataKey="building"
                stackId="1"
                stroke="var(--color-building)"
                fill="var(--color-building)"
                fillOpacity={0.6}
              />
            </AreaChart>
          ) : (
            <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={30}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) => {
                      const item = payload[0]?.payload as { fullDate?: string } | undefined
                      return item?.fullDate ?? ''
                    }}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar
                dataKey="successful"
                stackId="a"
                fill="var(--color-successful)"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="failed"
                stackId="a"
                fill="var(--color-failed)"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="building"
                stackId="a"
                fill="var(--color-building)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          )}
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

interface DeploymentsByEnvironmentChartProps {
  isLoading?: boolean
}

export function DeploymentsByEnvironmentChart({ isLoading = false }: DeploymentsByEnvironmentChartProps) {
  const data = useMemo(() => generateEnvironmentData(), [])

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[250px] w-full" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Deployments by Environment</CardTitle>
        <CardDescription>Distribution of deployments across environments</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={envChartConfig} className="h-[250px] w-full">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tickLine={false} axisLine={false} />
            <YAxis
              type="category"
              dataKey="environment"
              tickLine={false}
              axisLine={false}
              width={90}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar
              dataKey="successful"
              stackId="a"
              fill="var(--color-successful)"
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="failed"
              stackId="a"
              fill="var(--color-failed)"
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
