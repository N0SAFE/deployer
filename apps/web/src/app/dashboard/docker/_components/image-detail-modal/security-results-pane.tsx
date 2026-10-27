'use client'

import { type ChangeEvent, useMemo, useState } from 'react'
import type { DockerImageSecurityScanSummary, DockerVulnerabilityEntry } from '@deployer/contracts-entities'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Search } from 'lucide-react'
import { DockerCopyButton } from '../docker-copy-button'
import {
  buildVulnerabilityRowKey,
  filterAndSortVulnerabilities,
  type VulnerabilityScannerFilter,
  type VulnerabilitySeverityFilter,
  type VulnerabilitySort,
} from './scan-model'

const SELECT_CLASS = 'h-8 rounded border bg-background px-2 text-xs'

type ScannerSummary = NonNullable<DockerImageSecurityScanSummary['scanners']>[number]

interface SecurityResultsPaneProps {
  vulnerabilities: readonly DockerVulnerabilityEntry[]
  scannerSummaries: readonly ScannerSummary[]
  layerEfficiency: DockerImageSecurityScanSummary['layerEfficiency'] | undefined
}

const isSevere = (severity: DockerVulnerabilityEntry['severity']): boolean => severity === 'critical' || severity === 'high'

function ScannerSources({ sources, idPrefix }: { sources: readonly string[]; idPrefix: string }) {
  return (
    <>
      {sources.map((source) => (
        <Badge key={`${idPrefix}-${source}`} variant="secondary" className="text-xs uppercase tracking-wide">{source}</Badge>
      ))}
    </>
  )
}

/** Findings list + detail pane with search, severity, scanner and sort controls. */
export function SecurityResultsPane({ vulnerabilities, scannerSummaries, layerEfficiency }: SecurityResultsPaneProps) {
  const [search, setSearch] = useState('')
  const [severity, setSeverity] = useState<VulnerabilitySeverityFilter>('all')
  const [scanner, setScanner] = useState<VulnerabilityScannerFilter>('all')
  const [sort, setSort] = useState<VulnerabilitySort>('severity-desc')
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null)

  const filtersActive = search.trim().length > 0 || severity !== 'all' || scanner !== 'all'

  const rows = useMemo(
    () => filterAndSortVulnerabilities(vulnerabilities, { search, severity, scanner, sort })
      .map((vulnerability, index) => ({ vulnerability, rowKey: buildVulnerabilityRowKey(vulnerability, index) })),
    [vulnerabilities, search, severity, scanner, sort],
  )

  const selected = rows.find((row) => row.rowKey === selectedRowKey)?.vulnerability ?? rows[0]?.vulnerability ?? null

  return (
    <div className="mt-0 flex h-full min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <div className="space-y-2 rounded border bg-muted/10 p-2">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {scannerSummaries.length > 0 ? scannerSummaries.map((summary) => (
            <div key={`scanner-summary-${summary.scanner}`} className="rounded border bg-background px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide">{summary.scanner}</span>
                <Badge className="text-xs" variant={summary.status === 'failed' ? 'destructive' : summary.status === 'completed' ? 'default' : 'outline'}>
                  {summary.status}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {summary.findingsCount} findings{summary.durationMs === null ? '' : ` · ${String(summary.durationMs)} ms`}
              </p>
              {summary.error ? <p className="mt-1 line-clamp-2 text-xs text-destructive">{summary.error}</p> : null}
            </div>
          )) : (
            <div className="rounded border border-dashed bg-background px-3 py-2 text-xs text-muted-foreground sm:col-span-2 xl:col-span-4">
              Scanner summaries (Trivy, Grype, Dive) appear here once a scan has completed.
            </div>
          )}

          {layerEfficiency ? (
            <div className="rounded border bg-background px-3 py-2 sm:col-span-2 xl:col-span-1">
              <p className="text-xs font-semibold uppercase tracking-wide">Layer efficiency (dive)</p>
              <p className="mt-1 text-xs text-muted-foreground">
                score {layerEfficiency.efficiencyScore ?? 'n/a'} · wasted {layerEfficiency.estimatedWastedPercent ?? 'n/a'}%
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-58 max-w-md flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Search findings"
              value={search}
              onChange={(event: ChangeEvent<HTMLInputElement>) => { setSearch(event.target.value) }}
              className="h-8 pl-8 text-xs"
              placeholder="Search CVE, package, scanner, layer…"
            />
          </div>
          <select aria-label="Filter by severity" className={SELECT_CLASS} value={severity} onChange={(event) => { setSeverity(event.target.value as VulnerabilitySeverityFilter) }}>
            <option value="all">Severity: all</option>
            <option value="critical">critical</option>
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>
          <select aria-label="Filter by scanner" className={SELECT_CLASS} value={scanner} onChange={(event) => { setScanner(event.target.value as VulnerabilityScannerFilter) }}>
            <option value="all">Scanner: all</option>
            <option value="trivy">Scanner: trivy</option>
            <option value="grype">Scanner: grype</option>
            <option value="dive">Scanner: dive</option>
            <option value="multi-source">Scanner: multi-source</option>
            <option value="unmapped">Not mapped to a layer</option>
          </select>
          <select aria-label="Sort findings" className={SELECT_CLASS} value={sort} onChange={(event) => { setSort(event.target.value as VulnerabilitySort) }}>
            <option value="severity-desc">Sort: severity, worst first</option>
            <option value="severity-asc">Sort: severity, mildest first</option>
            <option value="package-asc">Sort: package A→Z</option>
            <option value="package-desc">Sort: package Z→A</option>
          </select>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-2 overflow-hidden lg:grid-cols-[1.2fr_.8fr]">
        <div className="h-full divide-y overflow-auto rounded border bg-background">
          {rows.length > 0 ? rows.map(({ vulnerability, rowKey }) => {
            const isActive = selected === vulnerability
            return (
              <button
                key={rowKey}
                type="button"
                aria-pressed={isActive}
                className={`w-full p-3 text-left transition-colors ${isActive ? 'border-l-2 border-primary bg-primary/10' : 'hover:bg-muted/40'}`}
                onClick={() => { setSelectedRowKey(rowKey) }}
              >
                <div className="flex items-center justify-between gap-2">
                  <code className="break-all font-mono text-xs">{vulnerability.id}</code>
                  <Badge className="text-xs" variant={isSevere(vulnerability.severity) ? 'destructive' : 'outline'}>{vulnerability.severity}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {vulnerability.packageName} · <span className="font-mono">{vulnerability.currentVersion}</span>
                  {vulnerability.fixedVersion ? <> → <span className="font-mono">{vulnerability.fixedVersion}</span></> : ' · no fix yet'}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <ScannerSources sources={vulnerability.scannerSources ?? []} idPrefix={rowKey} />
                  <Badge variant="outline" className="text-xs">{vulnerability.layerDigest || vulnerability.layerId ? 'mapped to a layer' : 'not mapped to a layer'}</Badge>
                </div>
              </button>
            )
          }) : vulnerabilities.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">No vulnerabilities were reported for this image.</p>
          ) : (
            <p className="p-3 text-xs text-muted-foreground">
              No findings match these filters.{filtersActive ? ' Widen the severity or scanner filter, or clear the search.' : ''}
            </p>
          )}
        </div>

        <div className="h-full overflow-auto rounded border bg-background p-3 text-xs">
          {selected ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1">
                  <code className="break-all font-mono">{selected.id}</code>
                  <DockerCopyButton value={selected.id} label="CVE id" />
                </span>
                <Badge className="text-xs" variant={isSevere(selected.severity) ? 'destructive' : 'outline'}>{selected.severity}</Badge>
              </div>
              <p><span className="text-muted-foreground">Package:</span> {selected.packageName}</p>
              <p><span className="text-muted-foreground">Installed:</span> <span className="font-mono">{selected.currentVersion}</span></p>
              <p><span className="text-muted-foreground">Fixed in:</span> <span className="font-mono">{selected.fixedVersion ?? 'No fix available'}</span></p>
              <p className="break-all"><span className="text-muted-foreground">Layer digest:</span> <span className="font-mono">{selected.layerDigest ?? selected.layerId ?? 'Not provided by scanner'}</span></p>
              <p className="text-muted-foreground">{selected.description}</p>
              {(selected.scannerSources ?? []).length > 0 ? (
                <div className="flex flex-wrap gap-1 pt-1"><ScannerSources sources={selected.scannerSources ?? []} idPrefix={selected.id} /></div>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground">Select a finding to see its details.</p>
          )}
        </div>
      </div>
    </div>
  )
}
