'use client'

import { useState } from 'react'
import type { DockerImageLayerEntry } from '@repo/contracts-entities'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { DockerRelativeTime } from '../docker-relative-time'
import { DockerCopyableId } from '../docker-copy-button'
import type { LayerRisk } from './scan-model'

type LayerStatus = 'clean' | 'unconfirmed' | 'findings' | 'pending'

const STATUS_LABEL: Record<LayerStatus, string> = {
  clean: 'no findings',
  unconfirmed: 'unconfirmed',
  findings: 'has findings',
  pending: 'not scanned yet',
}

const STATUS_VARIANT: Record<LayerStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  clean: 'default',
  unconfirmed: 'secondary',
  findings: 'destructive',
  pending: 'outline',
}

interface ImageLayersTabProps {
  layers: readonly DockerImageLayerEntry[]
  layerRiskById: ReadonlyMap<string, LayerRisk>
  hasCompletedScan: boolean
  unmappedVulnerabilityCount: number
}

export function ImageLayersTab({ layers, layerRiskById, hasCompletedScan, unmappedVulnerabilityCount }: ImageLayersTabProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  function statusOf(layerId: string): LayerStatus {
    if (!hasCompletedScan) return 'pending'
    if ((layerRiskById.get(layerId)?.findings.length ?? 0) > 0) return 'findings'
    return unmappedVulnerabilityCount > 0 ? 'unconfirmed' : 'clean'
  }

  if (layers.length === 0) {
    return (
      <div className="rounded border border-dashed p-4 text-sm text-muted-foreground">
        No layer metadata is available for this image yet. Run a security scan from the Security tab to load it.
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 divide-y overflow-auto rounded border text-sm">
      {layers.map((layer) => {
        const risk = layerRiskById.get(layer.id)
        const sources = risk ? Array.from(risk.scannerSources.values()) : []
        const status = statusOf(layer.id)
        const expanded = expandedId === layer.id
        const panelId = `layer-${layer.id.replace(/[^a-zA-Z0-9]/gu, '')}`

        return (
          <div key={layer.id} className="p-2">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={panelId}
              className="w-full rounded-sm px-2 py-1.5 transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => { setExpandedId((previous) => (previous === layer.id ? null : layer.id)) }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  {expanded ? <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  <p className="break-all text-left font-mono text-xs">{layer.instruction}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge className="text-xs" variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
                  <Badge className="text-xs tabular-nums" variant="outline">{layer.size}</Badge>
                </div>
              </div>
            </button>
            {expanded ? (
              <div id={panelId} className="mt-2 rounded border bg-muted/20 p-2 text-xs">
                <div className="grid gap-2 md:grid-cols-2">
                  <div>
                    <p className="text-muted-foreground">Layer ID</p>
                    <DockerCopyableId value={layer.id} short={layer.id.replace(/^sha256:/u, '').slice(0, 19)} label="layer ID" />
                  </div>
                  <div>
                    <p className="text-muted-foreground">Created</p>
                    <DockerRelativeTime value={layer.createdAt} />
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-muted-foreground">Risk</p>
                    {risk && risk.findings.length > 0 ? (
                      <p>{risk.findings.length} finding{risk.findings.length === 1 ? '' : 's'} in this layer (worst: {risk.severity ?? 'unknown'})</p>
                    ) : !hasCompletedScan ? (
                      <p>Waiting for the scan to finish…</p>
                    ) : unmappedVulnerabilityCount > 0 ? (
                      <p>{unmappedVulnerabilityCount} finding{unmappedVulnerabilityCount === 1 ? ' was' : 's were'} reported without a layer, so none can be tied to this one.</p>
                    ) : (
                      <p>No findings in this layer.</p>
                    )}
                  </div>
                  {sources.length > 0 ? (
                    <div className="md:col-span-2">
                      <p className="text-muted-foreground">Detected by</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {sources.map((source) => <Badge key={`${layer.id}-${source}`} variant="secondary" className="text-xs uppercase tracking-wide">{source}</Badge>)}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
