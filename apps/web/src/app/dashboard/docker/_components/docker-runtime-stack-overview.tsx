'use client'

import { Badge } from '@repo/ui/components/shadcn/badge'

interface DockerRuntimeStackOverviewProps {
  image: string
  pullStatus: 'idle' | 'pulling' | 'complete' | 'error'
  scanStatus: 'idle' | 'scanning' | 'complete' | 'error'
  portsCount: number
  volumesCount: number
  envVarsCount: number
  labelsCount: number
  networkMode: string
  selectedNetworksCount: number
}

export function DockerRuntimeStackOverview({
  image,
  pullStatus,
  scanStatus,
  portsCount,
  volumesCount,
  envVarsCount,
  labelsCount,
  networkMode,
  selectedNetworksCount,
}: DockerRuntimeStackOverviewProps) {
  return (
    <div className="rounded border bg-muted/20 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">Runtime stack overview</p>
        <Badge variant="outline" className="text-[10px]">Dedicated stack component</Badge>
      </div>

      <div className="grid gap-2 md:grid-cols-3 text-xs">
        <div className="rounded border bg-background p-2.5">
          <p className="text-muted-foreground">Image stack</p>
          <p className="mt-1 truncate font-mono text-[11px]">{image || 'Not set'}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">pull: {pullStatus} • scan: {scanStatus}</p>
        </div>
        <div className="rounded border bg-background p-2.5">
          <p className="text-muted-foreground">Network stack</p>
          <p className="mt-1">mode: <span className="font-medium">{networkMode}</span></p>
          <p className="text-[11px] text-muted-foreground">attached: {selectedNetworksCount}</p>
        </div>
        <div className="rounded border bg-background p-2.5">
          <p className="text-muted-foreground">Config stack</p>
          <p className="mt-1">ports: <span className="font-medium">{portsCount}</span> • volumes: <span className="font-medium">{volumesCount}</span></p>
          <p className="text-[11px] text-muted-foreground">env: {envVarsCount} • labels: {labelsCount}</p>
        </div>
      </div>
    </div>
  )
}
