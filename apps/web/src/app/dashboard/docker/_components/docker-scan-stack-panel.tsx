'use client'

import {
    AlertCircle,
    Moon,
    Shield,
    ShieldAlert,
    ShieldCheck,
    ShieldX,
    Sun,
    Terminal,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'

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

    const totalVulnerabilities =
        scanVulns.critical + scanVulns.high + scanVulns.medium + scanVulns.low
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
                window.localStorage.setItem(
                    'docker-scan-log-theme',
                    next ? 'dark' : 'light'
                )
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
                <Shield className="text-muted-foreground h-4 w-4" />
                <span className="text-muted-foreground text-sm">
                    Ready to scan
                </span>
            </>
        ) : scanStatus === 'scanning' ? (
            <>
                <Shield className="h-4 w-4 animate-pulse text-sky-500" />
                <span className="text-sm text-sky-600 dark:text-sky-400">
                    Scanning for vulnerabilities…
                </span>
            </>
        ) : scanStatus === 'error' ? (
            <>
                <ShieldX className="text-destructive h-4 w-4" />
                <span className="text-destructive text-sm">Scan failed</span>
            </>
        ) : hasCriticalOrHigh ? (
            <>
                <ShieldX className="h-4 w-4 text-red-500" />
                <span className="text-sm text-red-600 dark:text-red-400">
                    Critical vulnerabilities detected
                </span>
            </>
        ) : totalVulnerabilities > 0 ? (
            <>
                <ShieldAlert className="h-4 w-4 text-amber-500" />
                <span className="text-sm text-amber-600 dark:text-amber-400">
                    Vulnerabilities found
                </span>
            </>
        ) : (
            <>
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                <span className="text-sm text-emerald-600 dark:text-emerald-400">
                    No vulnerabilities found
                </span>
            </>
        )

    const taggedLogs = useMemo(() => {
        return rawScanLines.map((line) => {
            const lower = line.toLowerCase()
            if (lower.includes('[trivy]')) {
                return {
                    tag: 'trivy',
                    tone: 'bg-teal-500',
                    message: line.replace(/.*\[trivy\]\s*/iu, ''),
                }
            }
            if (lower.includes('[grype]')) {
                return {
                    tag: 'grype',
                    tone: 'bg-violet-500',
                    message: line.replace(/.*\[grype\]\s*/iu, ''),
                }
            }
            if (lower.includes('[dive]')) {
                return {
                    tag: 'dive',
                    tone: 'bg-blue-500',
                    message: line.replace(/.*\[dive\]\s*/iu, ''),
                }
            }
            if (lower.includes('error')) {
                return { tag: 'error', tone: 'bg-red-500', message: line }
            }
            return { tag: 'scan', tone: 'bg-slate-500', message: line }
        })
    }, [rawScanLines])

    return (
        <div className="flex h-full min-h-0 flex-col gap-3">
            <div className="from-background to-muted/20 space-y-3 rounded-xl border bg-linear-to-b p-3">
                <div className="flex items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-2">
                        {headerStatusNode}
                    </div>
                    <div className="flex items-center gap-2">
                        {scanStatus === 'complete' &&
                        totalVulnerabilities > 0 ? (
                            <Badge
                                variant={
                                    hasCriticalOrHigh
                                        ? 'destructive'
                                        : 'secondary'
                                }
                                className="text-xs"
                            >
                                {totalVulnerabilities} vulns
                            </Badge>
                        ) : null}
                        <span className="text-muted-foreground min-w-12 text-right text-xs">
                            {scanStatus === 'scanning' ? 'running' : ''}
                        </span>
                    </div>
                </div>

                <div className="space-y-1">
                    <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
                        <span>Scan orchestrator progress</span>
                        <span>{scanProgress}%</span>
                    </div>
                    <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                        <div
                            className="h-full bg-linear-to-r from-sky-500 via-indigo-500 to-violet-500 transition-all"
                            style={{ width: `${String(scanProgress)}%` }}
                        />
                    </div>
                </div>

                <div className="grid grid-cols-4 gap-2 text-xs">
                    <div className="bg-background rounded border p-2">
                        Critical: <strong>{scanVulns.critical}</strong>
                    </div>
                    <div className="bg-background rounded border p-2">
                        High: <strong>{scanVulns.high}</strong>
                    </div>
                    <div className="bg-background rounded border p-2">
                        Medium: <strong>{scanVulns.medium}</strong>
                    </div>
                    <div className="bg-background rounded border p-2">
                        Low: <strong>{scanVulns.low}</strong>
                    </div>
                </div>

                {scanErrorMessage ? (
                    <div className="border-destructive/40 bg-destructive/10 text-destructive inline-flex items-start gap-2 rounded-md border p-2 text-xs">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
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
                            {scanStatus === 'error'
                                ? 'Retry scan'
                                : 'Start scan'}
                        </Button>
                    </div>
                ) : null}

                <div className="grid gap-2 md:grid-cols-4">
                    {scanStageSummaryRows.map((row) => (
                        <div
                            key={row.stage}
                            className="bg-muted/20 rounded border p-2.5"
                        >
                            <div className="mb-1 flex items-center justify-between gap-2">
                                <p className="text-xs font-medium tracking-wide uppercase">
                                    {titleCaseStage(row.stage)}
                                </p>
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
                                    className="text-xs"
                                >
                                    {row.status}
                                </Badge>
                            </div>
                            <p className="text-muted-foreground text-xs">
                                {row.last
                                    ? `${toClock(row.last.timestamp)} • ${row.last.message}`
                                    : 'No event yet'}
                            </p>
                            <p className="text-muted-foreground mt-1 text-xs">
                                peak {row.maxProgress}%
                            </p>
                        </div>
                    ))}
                </div>
            </div>

            <div className="space-y-2 rounded-xl border p-3">
                <div className="flex items-center justify-between gap-2">
                    <p className="text-muted-foreground text-xs font-medium">
                        Scanner stacks pull progress
                    </p>
                    <Badge variant="outline" className="text-xs">
                        Dockhand parity
                    </Badge>
                </div>
                <div className="grid gap-2 md:grid-cols-3">
                    {scannerPullRows.map((row) => (
                        <div
                            key={row.scanner}
                            className="bg-muted/20 rounded border p-2.5"
                        >
                            <div className="mb-1 flex items-center justify-between gap-2">
                                <p className="text-xs font-medium tracking-wide uppercase">
                                    {row.scanner}
                                </p>
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
                                    className="text-xs"
                                >
                                    {row.status}
                                </Badge>
                            </div>
                            <div className="bg-muted h-1.5 overflow-hidden rounded">
                                <div
                                    className="bg-primary h-full transition-all"
                                    style={{
                                        width: `${String(row.progress)}%`,
                                    }}
                                />
                            </div>
                            <p className="text-muted-foreground mt-1 text-xs">
                                {row.latestPull
                                    ? row.latestPull.message
                                    : 'No scanner pull event yet'}
                            </p>
                        </div>
                    ))}
                </div>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
                {scanSourceStreams.map((source) => (
                    <div
                        key={source.source}
                        className="space-y-2 rounded border p-2.5"
                    >
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium tracking-wide uppercase">
                                {source.source}
                            </p>
                            <Badge
                                variant={
                                    source.status === 'completed'
                                        ? 'default'
                                        : source.status === 'running'
                                          ? 'secondary'
                                          : 'outline'
                                }
                            >
                                {source.status}
                            </Badge>
                        </div>
                        <div className="bg-muted h-1.5 overflow-hidden rounded">
                            <div
                                className="bg-primary h-full transition-all"
                                style={{ width: `${String(source.progress)}%` }}
                            />
                        </div>
                        <p className="text-muted-foreground text-xs">
                            {source.findingsCount} findings • started{' '}
                            {source.startedAt}
                        </p>
                    </div>
                ))}
            </div>

            <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border">
                <div className="flex items-center gap-1 border-b px-3 py-2">
                    <button
                        type="button"
                        className={`border-b-2 px-2 py-1 text-xs font-medium ${activeTab === 'output' ? 'border-primary text-foreground' : 'text-muted-foreground hover:text-foreground border-transparent'}`}
                        onClick={() => {
                            setTabTouched(true)
                            setActiveTab('output')
                        }}
                    >
                        <Terminal className="mr-1 inline h-3 w-3" />
                        Output
                    </button>
                    <button
                        type="button"
                        className={`border-b-2 px-2 py-1 text-xs font-medium ${activeTab === 'results' ? 'border-primary text-foreground' : 'text-muted-foreground hover:text-foreground border-transparent'}`}
                        onClick={() => {
                            setTabTouched(true)
                            setActiveTab('results')
                        }}
                        disabled={scanFindings.length === 0}
                    >
                        Results
                        {scanFindings.length > 0 ? (
                            <Badge variant="secondary" className="ml-1 text-xs">
                                {scanFindings.length}
                            </Badge>
                        ) : null}
                    </button>

                    <div className="ml-auto">
                        <button
                            type="button"
                            onClick={toggleLogTheme}
                            className="hover:bg-muted/60 inline-flex h-7 w-7 items-center justify-center rounded border"
                            title="Toggle log theme"
                        >
                            {logDarkMode ? (
                                <Sun className="h-3.5 w-3.5" />
                            ) : (
                                <Moon className="h-3.5 w-3.5" />
                            )}
                        </button>
                    </div>
                </div>

                {effectiveActiveTab === 'results' ? (
                    <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[1.25fr_.75fr]">
                        <div className="min-h-0 overflow-auto">
                            <DockerScanFindingsDataTable
                                findings={scanFindings}
                            />
                        </div>

                        <div className="min-h-0 overflow-auto border-l p-3 text-xs">
                            <p className="mb-2 font-medium">Severity summary</p>
                            <div className="text-muted-foreground space-y-1">
                                <p>
                                    Critical:{' '}
                                    <strong className="text-foreground">
                                        {scanVulns.critical}
                                    </strong>
                                </p>
                                <p>
                                    High:{' '}
                                    <strong className="text-foreground">
                                        {scanVulns.high}
                                    </strong>
                                </p>
                                <p>
                                    Medium:{' '}
                                    <strong className="text-foreground">
                                        {scanVulns.medium}
                                    </strong>
                                </p>
                                <p>
                                    Low:{' '}
                                    <strong className="text-foreground">
                                        {scanVulns.low}
                                    </strong>
                                </p>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="min-h-0 flex-1 overflow-auto p-2">
                        <div
                            ref={logViewportRef}
                            className={`${logDarkMode ? 'bg-zinc-950 text-zinc-300' : 'bg-zinc-100 text-zinc-700'} min-h-full overflow-auto rounded-lg p-3 font-mono text-xs`}
                        >
                            {taggedLogs.length > 0 ? (
                                taggedLogs.map((line, index) => (
                                    <div
                                        key={`scan-log-${String(index)}`}
                                        className="flex items-start gap-1.5 leading-relaxed break-all whitespace-pre-wrap"
                                    >
                                        <span
                                            className={`mt-0.75 inline-flex shrink-0 items-center rounded px-1 text-[8px] font-medium text-white shadow-[0_1px_1px_rgba(0,0,0,0.2)] ${line.tone}`}
                                        >
                                            {line.tag}
                                        </span>
                                        <span>{line.message}</span>
                                    </div>
                                ))
                            ) : (
                                <p className="text-muted-foreground">
                                    No scan output yet.
                                </p>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
