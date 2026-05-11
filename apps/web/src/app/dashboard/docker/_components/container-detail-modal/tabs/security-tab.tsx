import type {
  DockerImageSecurityScanEvent,
  DockerImageSecurityScanSummary,
  DockerVulnerabilityEntry,
} from '@repo/contracts-entities'
import { Badge } from '@repo/ui/components/shadcn/badge'

interface DockerContainerSecurityTabProps {
  severityCounts: Record<DockerVulnerabilityEntry['severity'], number>
  imageId: string | null | undefined
  isFetching: boolean
  hasScannerDetail: boolean
  errorMessage: string | null
  scanSummary: DockerImageSecurityScanSummary | null
  scanEvents: DockerImageSecurityScanEvent[]
  scanStreamStatus: 'idle' | 'streaming' | 'error'
  privileged: boolean
  readOnlyRootFs: boolean
  networkMode: string | null
  health: string
  vulnerabilities: DockerVulnerabilityEntry[]
}

export function DockerContainerSecurityTab({
  severityCounts,
  imageId,
  isFetching,
  hasScannerDetail,
  errorMessage,
  scanSummary,
  scanEvents,
  scanStreamStatus,
  privileged,
  readOnlyRootFs,
  networkMode,
  health,
  vulnerabilities,
}: DockerContainerSecurityTabProps) {
  const scannerSummaries = scanSummary?.scanners ?? []
  const streamLogEvents = scanEvents.filter((event) => event.type === 'log').slice(-120)
  const streamStatusEvents = scanEvents.filter((event) => event.type !== 'log').slice(-60)

  return (
    <div className="space-y-2 text-sm">
      <div className="grid gap-2 md:grid-cols-4">
        <div className="rounded border p-3">
          <p className="text-xs text-muted-foreground">Critical</p>
          <p className="mt-1 text-lg font-semibold">{severityCounts.critical}</p>
        </div>
        <div className="rounded border p-3">
          <p className="text-xs text-muted-foreground">High</p>
          <p className="mt-1 text-lg font-semibold">{severityCounts.high}</p>
        </div>
        <div className="rounded border p-3">
          <p className="text-xs text-muted-foreground">Medium</p>
          <p className="mt-1 text-lg font-semibold">{severityCounts.medium}</p>
        </div>
        <div className="rounded border p-3">
          <p className="text-xs text-muted-foreground">Low</p>
          <p className="mt-1 text-lg font-semibold">{severityCounts.low}</p>
        </div>
      </div>

      <div className="rounded border p-3 text-xs text-muted-foreground">
        {imageId
          ? (
              isFetching
                ? 'Scanning image vulnerabilities (Trivy + Grype + Dive)…'
                : `Scanner source: ${hasScannerDetail ? 'Trivy + Grype + Dive container scan' : 'unavailable'}`
            )
          : 'No image ID available for this container; vulnerability scanning is unavailable.'}
      </div>

      {scannerSummaries.length > 0 ? (
        <div className="grid gap-2 md:grid-cols-3">
          {scannerSummaries.map((scanner) => (
            <div key={scanner.scanner} className="rounded border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {scanner.scanner}
                </p>
                <Badge variant={scanner.status === 'completed' ? 'outline' : scanner.status === 'failed' ? 'destructive' : 'secondary'}>
                  {scanner.status}
                </Badge>
              </div>
              <p className="mt-2 text-lg font-semibold">{scanner.findingsCount}</p>
              <p className="text-xs text-muted-foreground">findings</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {scanner.durationMs === null ? 'duration unavailable' : `${String(scanner.durationMs)} ms`}
              </p>
              {scanner.error ? (
                <p className="mt-1 line-clamp-2 text-[11px] text-destructive/80">{scanner.error}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {scanSummary?.layerEfficiency ? (
        <div className="rounded border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">Dive layer efficiency</p>
            <Badge variant="outline">{scanSummary.layerEfficiency.efficiencyScore ?? '—'}%</Badge>
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-3 text-xs">
            <div>
              <p className="text-muted-foreground">Efficiency score</p>
              <p className="font-medium">{scanSummary.layerEfficiency.efficiencyScore ?? '—'}%</p>
            </div>
            <div>
              <p className="text-muted-foreground">Estimated wasted</p>
              <p className="font-medium">{scanSummary.layerEfficiency.estimatedWastedPercent ?? '—'}%</p>
            </div>
            <div>
              <p className="text-muted-foreground">Wasted bytes</p>
              <p className="font-medium">{scanSummary.layerEfficiency.estimatedWastedBytes ?? '—'}</p>
            </div>
          </div>
          {scanSummary.layerEfficiency.notes.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {scanSummary.layerEfficiency.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="rounded border p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">Live scan stream</p>
          <Badge variant={scanStreamStatus === 'error' ? 'destructive' : scanStreamStatus === 'streaming' ? 'default' : 'outline'}>
            {scanStreamStatus}
          </Badge>
        </div>
        <div className="grid gap-2 lg:grid-cols-2">
          <div className="rounded border bg-muted/20 p-2">
            <p className="text-[11px] font-medium text-muted-foreground">Scanner status timeline</p>
            <div className="mt-2 max-h-40 space-y-1 overflow-auto text-[11px]">
              {streamStatusEvents.length > 0 ? streamStatusEvents.map((event) => (
                <div key={`${event.timestamp}-${event.type}-${event.message}-${event.scanner ?? 'none'}`} className="rounded border bg-background/70 px-2 py-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="uppercase tracking-wide text-muted-foreground">{event.scanner ?? 'pipeline'}</span>
                    <span className="text-muted-foreground">{event.timestamp.slice(11, 19)}</span>
                  </div>
                  <p>{event.message}</p>
                </div>
              )) : (
                <p className="text-muted-foreground">Waiting for scanner stream events…</p>
              )}
            </div>
          </div>
          <div className="rounded border bg-black p-2">
            <p className="text-[11px] font-medium text-zinc-300">Scanner logs</p>
            <div className="mt-2 max-h-40 space-y-1 overflow-auto font-mono text-[11px] text-zinc-100">
              {streamLogEvents.length > 0 ? streamLogEvents.map((event, index) => (
                <p key={`${event.timestamp}-${event.scanner ?? 'none'}-${String(index)}`}>
                  <span className="text-zinc-400">[{event.timestamp.slice(11, 19)}]</span>{' '}
                  <span className="text-cyan-300">{event.scanner ?? 'pipeline'}</span>{' '}
                  {event.logLine ?? event.message}
                </p>
              )) : (
                <p className="text-zinc-400">No scanner logs streamed yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {errorMessage ? (
        <div className="rounded border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          Failed to load vulnerability report: {errorMessage}
        </div>
      ) : null}

      <div className="rounded border p-3">
        <p className="text-xs font-medium text-muted-foreground">Runtime hardening checks</p>
        <div className="mt-2 space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Privileged mode</span>
            <Badge variant={privileged ? 'destructive' : 'outline'}>{privileged ? 'enabled' : 'disabled'}</Badge>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Readonly root filesystem</span>
            <span>{readOnlyRootFs ? 'yes' : 'no'}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Network mode</span>
            <span>{networkMode ?? 'bridge'}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Runtime health</span>
            <Badge variant={health === 'unhealthy' ? 'destructive' : 'outline'}>{health}</Badge>
          </div>
        </div>
      </div>

      <div className="rounded border divide-y max-h-72 overflow-auto">
        {vulnerabilities.length > 0 ? (
          vulnerabilities.map((entry) => (
            <div key={`${entry.id}-${entry.packageName}-${entry.currentVersion}`} className="p-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <code className="font-mono text-xs">{entry.id}</code>
                <Badge variant={entry.severity === 'critical' || entry.severity === 'high' ? 'destructive' : 'outline'}>{entry.severity}</Badge>
              </div>
              {(entry.scannerSources ?? []).length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {(entry.scannerSources ?? []).map((source) => (
                    <Badge key={`${entry.id}-${source}`} variant="secondary" className="text-[10px] uppercase tracking-wide">
                      {source}
                    </Badge>
                  ))}
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">{entry.packageName} {entry.currentVersion} → {entry.fixedVersion ?? 'no fix available'}</p>
              <p>{entry.description}</p>
            </div>
          ))
        ) : (
          <p className="p-3 text-xs text-muted-foreground">
            {isFetching
              ? 'Collecting vulnerability results…'
              : 'No vulnerabilities reported by available scanners for this image.'}
          </p>
        )}
      </div>
    </div>
  )
}