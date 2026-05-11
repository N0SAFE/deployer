import type { DockerContainerInspectDetail } from '@repo/contracts-entities'
import { Badge } from '@repo/ui/components/shadcn/badge'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@repo/ui/components/shadcn/chart'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'

const overviewChartConfig = {
  cpu: {
    label: 'CPU %',
    color: 'var(--chart-1)',
  },
  memory: {
    label: 'Memory %',
    color: 'var(--chart-2)',
  },
} satisfies ChartConfig

interface DockerContainerOverviewTabProps {
  detail: {
    name: string
    status: string
    health: string
    environment: string | null
    updatedAt: string
    serviceId: string
    stackId: string | null
    imageId: string | null
  }
  inspectDetail: DockerContainerInspectDetail | null
  metricSummary: {
    cpuPeak: number
    memPeak: number
    rxPeak: number
    txPeak: number
    cpuCurrent: number
    memCurrent: number
    rxCurrent: number
    txCurrent: number
    rxTotal: number
    txTotal: number
  }
  metricChartData: Array<{
    tick: string
    index: number
    cpu: number
    memory: number
  }>
}

export function DockerContainerOverviewTab({
  detail,
  inspectDetail,
  metricSummary,
  metricChartData,
}: DockerContainerOverviewTabProps) {
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 md:grid-cols-[1.2fr_1fr]">
        <div className="rounded border p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium">{detail.name}</p>
            <Badge variant={detail.status === 'running' ? 'default' : detail.status === 'restarting' ? 'secondary' : 'outline'}>{detail.status}</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={detail.health === 'healthy' ? 'default' : detail.health === 'starting' ? 'secondary' : 'outline'}>
              health: {detail.health}
            </Badge>
            <Badge variant="outline">env: {detail.environment ?? '—'}</Badge>
            <Badge variant="outline">updated: {detail.updatedAt}</Badge>
          </div>
          <div className="grid gap-2 text-xs md:grid-cols-2">
            <div className="rounded bg-muted/30 px-2 py-1.5">
              <p className="text-muted-foreground">Service ID</p>
              <p className="font-mono break-all">{detail.serviceId}</p>
            </div>
            <div className="rounded bg-muted/30 px-2 py-1.5">
              <p className="text-muted-foreground">Stack ID</p>
              <p className="font-mono break-all">{detail.stackId ?? '—'}</p>
            </div>
            <div className="rounded bg-muted/30 px-2 py-1.5 md:col-span-2">
              <p className="text-muted-foreground">Image ID</p>
              <p className="font-mono break-all">{detail.imageId ?? '—'}</p>
            </div>
          </div>
        </div>

        <div className="rounded border p-3 space-y-2">
          <p className="text-xs text-muted-foreground">Runtime capabilities</p>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">logs: {inspectDetail?.streamingLogsSupported ? 'streaming' : 'disabled'}</Badge>
            <Badge variant="outline">watch: {inspectDetail?.runtimeConfig.watchMode ?? 'disabled'}</Badge>
            <Badge variant="outline">restart: {inspectDetail?.runtimeConfig.restartPolicy ?? 'n/a'}</Badge>
            <Badge variant="outline">depends_on: {inspectDetail?.composeConfig?.dependsOn.length ?? 0}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded bg-blue-500/10 px-2 py-1.5 text-blue-700 dark:text-blue-300">
              <p>RX total</p>
              <p className="font-semibold">{Math.round(metricSummary.rxTotal)} KB</p>
            </div>
            <div className="rounded bg-purple-500/10 px-2 py-1.5 text-purple-700 dark:text-purple-300">
              <p>TX total</p>
              <p className="font-semibold">{Math.round(metricSummary.txTotal)} KB</p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded border p-3">
        <div className="mb-3 flex items-center justify-between gap-2 text-xs">
          <p className="text-muted-foreground">CPU/Memory telemetry</p>
          <div className="flex items-center gap-2">
            <Badge variant="outline">CPU {metricSummary.cpuCurrent.toFixed(1)}%</Badge>
            <Badge variant="outline">Memory {metricSummary.memCurrent.toFixed(1)}%</Badge>
          </div>
        </div>

        <ChartContainer config={overviewChartConfig} className="h-56 w-full aspect-auto">
          <LineChart data={metricChartData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="tick"
              tickLine={false}
              axisLine={false}
              minTickGap={24}
              tickFormatter={(value: string | number, index: number) => (index % 4 === 0 ? String(value) : '')}
            />
            <YAxis
              domain={[0, 100]}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value: string | number) => `${String(value)}%`}
              width={36}
            />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent indicator="line" />}
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Line
              type="monotone"
              dataKey="cpu"
              stroke="var(--color-cpu)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="memory"
              stroke="var(--color-memory)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      </div>

      <div className="grid gap-2 md:grid-cols-4 text-xs">
        <div className="rounded border bg-muted/30 p-2">CPU peak: <span className="font-semibold">{metricSummary.cpuPeak.toFixed(1)}%</span></div>
        <div className="rounded border bg-muted/30 p-2">Mem peak: <span className="font-semibold">{metricSummary.memPeak.toFixed(1)}%</span></div>
        <div className="rounded border bg-muted/30 p-2">RX now: <span className="font-semibold">{metricSummary.rxCurrent.toFixed(0)} KB/s</span></div>
        <div className="rounded border bg-muted/30 p-2">TX now: <span className="font-semibold">{metricSummary.txCurrent.toFixed(0)} KB/s</span></div>
      </div>
    </div>
  )
}
