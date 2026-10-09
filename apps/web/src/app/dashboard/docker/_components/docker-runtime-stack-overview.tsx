'use client'

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

/** Compact summary of what a container is about to be created with. */
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
    <section aria-label="Runtime stack overview" className="space-y-2 rounded border bg-muted/20 p-3">
      <h3 className="text-sm font-medium text-muted-foreground">Summary</h3>
      <dl className="grid gap-2 text-sm md:grid-cols-3">
        <div className="rounded border bg-background p-2.5">
          <dt className="text-muted-foreground">Image</dt>
          <dd className="mt-1 truncate font-mono text-xs" title={image || undefined}>{image || 'Not set'}</dd>
          <dd className="mt-1 text-xs text-muted-foreground">Pull: {pullStatus}. Security scan: {scanStatus}.</dd>
        </div>
        <div className="rounded border bg-background p-2.5">
          <dt className="text-muted-foreground">Networking</dt>
          <dd className="mt-1">Mode <span className="font-medium">{networkMode}</span></dd>
          <dd className="text-xs text-muted-foreground">{selectedNetworksCount} network{selectedNetworksCount === 1 ? '' : 's'} attached</dd>
        </div>
        <div className="rounded border bg-background p-2.5">
          <dt className="text-muted-foreground">Configuration</dt>
          <dd className="mt-1">
            <span className="font-medium">{portsCount}</span> ports, <span className="font-medium">{volumesCount}</span> volumes
          </dd>
          <dd className="text-xs text-muted-foreground">{envVarsCount} env vars, {labelsCount} labels</dd>
        </div>
      </dl>
    </section>
  )
}
