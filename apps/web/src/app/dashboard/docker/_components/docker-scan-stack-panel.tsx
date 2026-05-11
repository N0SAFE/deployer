'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { AlertCircle, Moon, Shield, ShieldAlert, ShieldCheck, ShieldX, Sun, Terminal } from 'lucide-react'
import { DockerScanFindingsDataTable } from './docker-scan-findings-data-table'

export interface DockerScanStageSummaryRow {
  stage: string
  status: 'pending' | 'active' | 'complete' | 'failed'
  maxProgress: number
  last: {
    timestamp: string
    message: string
  } | null
}

export interface DockerScannerPullRow {
  scanner: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress: number
  latestPull: {
    message: string
  } | null
}

export interface DockerScanSourceStreamRow {
  source: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress: number
  findingsCount: number
  startedAt: string
}

export interface DockerScanFindingRow {
  id: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  source: string
  packageName: string
  packageType: string
  currentVersion: string
  fixedVersion: string | null
}

interface DockerScanStackPanelProps {
  scanStatus: 'idle' | 'scanning' | 'complete' | 'error'
  scanProgress: number
  scanErrorMessage: string | null
  scanVulns: { critical: number; high: number; medium: number; low: number }
  scanStageSummaryRows: DockerScanStageSummaryRow[]
  scannerPullRows: DockerScannerPullRow[]
  scanSourceStreams: DockerScanSourceStreamRow[]
  scanFindings: DockerScanFindingRow[]
  rawScanLines: string[]
  canStartScan: boolean
  onStartScan: () => void
  titleCaseStage: (stage: string) => string
  toClock: (iso: string) => string
}

export function DockerScanStackPanel({
  scanStatus,
  scanProgress,
  scanErrorMessage,
  scanVulns,
  scanStageSummaryRows,
  scannerPullRows,
  scanSourceStreams,
  scanFindings,
  rawScanLines,
  canStartScan,
  onStartScan,
  titleCaseStage,
  toClock,
}: DockerScanStackPanelProps) {
  const logViewportRef = useRef<HTMLDivElement | null>(null)
  const [activeTab, setActiveTab] = useState<'output' | 'results'>('output')
  const [tabTouched, setTabTouched] = useState(false)
  const [logDarkMode, setLogDarkMode] = useState(() => {
    if (typeof window === 'undefined') {
      return true
    }

    const saved = window.localStorage.getItem('docker-scan-log-theme')
    return saved === null ? true : saved === 'dark'
  })

  const totalVulnerabilities = scanVulns.critical + scanVulns.high + scanVulns.medium + scanVulns.low
  const hasCriticalOrHigh = scanVulns.critical > 0 || scanVulns.high > 0

  useEffect(() => {
    if (!logViewportRef.current) {
      return
    }

    logViewportRef.current.scrollTop = logViewportRef.current.scrollHeight
  }, [rawScanLines])

  function toggleLogTheme(): void {
    setLogDarkMode((previous) => {
      const next = !previous
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('docker-scan-log-theme', next ? 'dark' : 'light')
      }
      return next
    })
  }

  const effectiveActiveTab: 'output' | 'results' =
    !tabTouched && scanStatus === 'complete' && totalVulnerabilities > 0
      ? 'results'
      : activeTab

  const headerStatusNode =
    scanStatus === 'idle' ? (
      <>
        <Shield className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Ready to scan</span>
      </>
    ) : scanStatus === 'scanning' ? (
      <>
        <Shield className="h-4 w-4 text-sky-500 animate-pulse" />
        <span className="text-sm text-sky-600 dark:text-sky-400">Scanning for vulnerabilities…</span>
      </>
    ) : scanStatus === 'error' ? (
      <>
        <ShieldX className="h-4 w-4 text-destructive" />
        <span className="text-sm text-destructive">Scan failed</span>
      </>
    ) : hasCriticalOrHigh ? (
      <>
        <ShieldX className="h-4 w-4 text-red-500" />
        <span className="text-sm text-red-600 dark:text-red-400">Critical vulnerabilities detected</span>
      </>
    ) : totalVulnerabilities > 0 ? (
      <>
        <ShieldAlert className="h-4 w-4 text-amber-500" />
        <span className="text-sm text-amber-600 dark:text-amber-400">Vulnerabilities found</span>
      </>
    ) : (
      <>
        <ShieldCheck className="h-4 w-4 text-emerald-500" />
        <span className="text-sm text-emerald-600 dark:text-emerald-400">No vulnerabilities found</span>
      </>
    )

  const taggedLogs = useMemo(() => {
    return rawScanLines.map((line) => {
      const lower = line.toLowerCase()
      if (lower.includes('[trivy]')) {
        return { tag: 'trivy', tone: 'bg-teal-500', message: line.replace(/.*\[trivy\]\s*/iu, '') }
      }
      if (lower.includes('[grype]')) {
        return { tag: 'grype', tone: 'bg-violet-500', message: line.replace(/.*\[grype\]\s*/iu, '') }
      }
      if (lower.includes('[dive]')) {
        return { tag: 'dive', tone: 'bg-blue-500', message: line.replace(/.*\[dive\]\s*/iu, '') }
      }
      if (lower.includes('error')) {
        return { tag: 'error', tone: 'bg-red-500', message: line }
      }
      return { tag: 'scan', tone: 'bg-slate-500', message: line }
    })
  }, [rawScanLines])

  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      <div className="rounded-xl border bg-linear-to-b from-background to-muted/20 p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2">{headerStatusNode}</div>
          <div className="flex items-center gap-2">
            {scanStatus === 'complete' && totalVulnerabilities > 0 ? (
              <Badge variant={hasCriticalOrHigh ? 'destructive' : 'secondary'} className="text-[10px]">
                {totalVulnerabilities} vulns
              </Badge>
            ) : null}
            <span className="text-xs text-muted-foreground min-w-12 text-right">{scanStatus === 'scanning' ? 'running' : ''}</span>
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Scan orchestrator progress</span>
            <span>{scanProgress}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-linear-to-r from-sky-500 via-indigo-500 to-violet-500 transition-all" style={{ width: `${String(scanProgress)}%` }} />
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 text-xs">
          <div className="rounded border bg-background p-2">Critical: <strong>{scanVulns.critical}</strong></div>
          <div className="rounded border bg-background p-2">High: <strong>{scanVulns.high}</strong></div>
          <div className="rounded border bg-background p-2">Medium: <strong>{scanVulns.medium}</strong></div>
          <div className="rounded border bg-background p-2">Low: <strong>{scanVulns.low}</strong></div>
        </div>

        {scanErrorMessage ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive inline-flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span className="break-all">{scanErrorMessage}</span>
          </div>
        ) : null}

        {scanStatus === 'idle' || scanStatus === 'error' ? (
          <div className="flex items-center justify-end">
            <Button
              size="sm"
              onClick={() => {
                setTabTouched(false)
                setActiveTab('output')
                onStartScan()
              }}
              disabled={!canStartScan}
            >
              {scanStatus === 'error' ? 'Retry scan' : 'Start scan'}
            </Button>
          </div>
        ) : null}

        <div className="grid gap-2 md:grid-cols-4">
          {scanStageSummaryRows.map((row) => (
            <div key={row.stage} className="rounded border bg-muted/20 p-2.5">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium uppercase tracking-wide">{titleCaseStage(row.stage)}</p>
                <Badge
                  variant={
                    row.status === 'failed'
                      ? 'destructive'
                      : row.status === 'complete'
                        ? 'default'
                        : row.status === 'active'
                          ? 'secondary'
                          : 'outline'
                  }
                  className="text-[10px]"
                >
                  {row.status}
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {row.last ? `${toClock(row.last.timestamp)} • ${row.last.message}` : 'No event yet'}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">peak {row.maxProgress}%</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">Scanner stacks pull progress</p>
          <Badge variant="outline" className="text-[10px]">Dockhand parity</Badge>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          {scannerPullRows.map((row) => (
            <div key={row.scanner} className="rounded border bg-muted/20 p-2.5">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide">{row.scanner}</p>
                <Badge
                  variant={
                    row.status === 'failed'
                      ? 'destructive'
                      : row.status === 'completed'
                        ? 'default'
                        : row.status === 'running'
                          ? 'secondary'
                          : 'outline'
                  }
                  className="text-[10px]"
                >
                  {row.status}
                </Badge>
              </div>
              <div className="h-1.5 rounded bg-muted overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${String(row.progress)}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {row.latestPull ? row.latestPull.message : 'No scanner pull event yet'}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {scanSourceStreams.map((source) => (
          <div key={source.source} className="rounded border p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide">{source.source}</p>
              <Badge variant={source.status === 'completed' ? 'default' : source.status === 'running' ? 'secondary' : 'outline'}>{source.status}</Badge>
            </div>
            <div className="h-1.5 rounded bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${String(source.progress)}%` }} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {source.findingsCount} findings • started {source.startedAt}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border min-h-0 overflow-hidden flex flex-col">
        <div className="border-b px-3 py-2 flex items-center gap-1">
          <button
            type="button"
            className={`px-2 py-1 text-xs font-medium border-b-2 ${activeTab === 'output' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            onClick={() => {
              setTabTouched(true)
              setActiveTab('output')
            }}
          >
            <Terminal className="h-3 w-3 inline mr-1" />
            Output
          </button>
          <button
            type="button"
            className={`px-2 py-1 text-xs font-medium border-b-2 ${activeTab === 'results' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            onClick={() => {
              setTabTouched(true)
              setActiveTab('results')
            }}
            disabled={scanFindings.length === 0}
          >
            Results
            {scanFindings.length > 0 ? <Badge variant="secondary" className="ml-1 text-[10px]">{scanFindings.length}</Badge> : null}
          </button>

          <div className="ml-auto">
            <button type="button" onClick={toggleLogTheme} className="inline-flex h-7 w-7 items-center justify-center rounded border hover:bg-muted/60" title="Toggle log theme">
              {logDarkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {effectiveActiveTab === 'results' ? (
          <div className="grid flex-1 min-h-0 gap-3 md:grid-cols-[1.25fr_.75fr]">
            <div className="min-h-0 overflow-auto">
              <DockerScanFindingsDataTable findings={scanFindings} />
            </div>

            <div className="border-l min-h-0 overflow-auto p-3 text-xs">
              <p className="font-medium mb-2">Severity summary</p>
              <div className="space-y-1 text-muted-foreground">
                <p>Critical: <strong className="text-foreground">{scanVulns.critical}</strong></p>
                <p>High: <strong className="text-foreground">{scanVulns.high}</strong></p>
                <p>Medium: <strong className="text-foreground">{scanVulns.medium}</strong></p>
                <p>Low: <strong className="text-foreground">{scanVulns.low}</strong></p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-auto p-2">
            <div
              ref={logViewportRef}
              className={`${logDarkMode ? 'bg-zinc-950 text-zinc-300' : 'bg-zinc-100 text-zinc-700'} rounded-lg p-3 font-mono text-xs min-h-full overflow-auto`}
            >
              {taggedLogs.length > 0 ? taggedLogs.map((line, index) => (
                <div key={`scan-log-${String(index)}`} className="whitespace-pre-wrap break-all leading-relaxed flex items-start gap-1.5">
                  <span className={`inline-flex items-center px-1 rounded text-[8px] font-medium text-white shadow-[0_1px_1px_rgba(0,0,0,0.2)] shrink-0 mt-0.75 ${line.tone}`}>
                    {line.tag}
                  </span>
                  <span>{line.message}</span>
                </div>
              )) : (
                <p className="text-muted-foreground">No scan output yet.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
