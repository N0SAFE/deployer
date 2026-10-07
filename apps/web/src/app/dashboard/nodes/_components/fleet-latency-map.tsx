'use client'

import {
  Map,
  MapArc,
  MapControls,
  MapMarker,
  MarkerContent,
  MarkerTooltip,
  type MapArcDatum,
} from '@/components/ui/map'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { cn } from '@repo/ui/lib/utils'
import { CircleDot } from 'lucide-react'
import { useTheme } from 'next-themes'

export interface FleetMapNode {
  nodeId: string
  label: string
  role: string
  lifecycleState: string
  sessionState: string
  isLocal: boolean
  /** `[latitude, longitude]` — the app-facing order, converted at the map boundary. */
  coordinates: [number, number]
}

export interface FleetMapLink {
  id: string
  sourceNodeId: string
  targetNodeId: string
  latencyMs: number
  jitterMs: number
  packetLossRatio: number
  reliabilityScore: number
  throughputMbps?: number
  state: string
  inferred: boolean
  measuredAt: string
}

function latencyColor(latencyMs: number): string {
  if (latencyMs <= 45) {
    return '#22c55e'
  }

  if (latencyMs <= 90) {
    return '#f59e0b'
  }

  return '#ef4444'
}

const LINK_PALETTE = ['#22c55e', '#3b82f6', '#a855f7', '#f59e0b', '#14b8a6', '#eab308', '#ec4899', '#06b6d4']

function linkColor(link: FleetMapLink): string {
  if (link.inferred) {
    return '#94a3b8'
  }

  if (link.state !== 'active' && link.state !== 'up' && link.state !== 'connected') {
    return '#ef4444'
  }

  if (link.latencyMs >= 120 || link.packetLossRatio >= 0.03) {
    return latencyColor(link.latencyMs)
  }

  const paletteIndex = stableHash(`${pairKey(link.sourceNodeId, link.targetNodeId)}:${link.id}`) % LINK_PALETTE.length
  return LINK_PALETTE[paletteIndex] ?? '#22c55e'
}

function stableHash(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`
}

/**
 * The app stores coordinates as `[latitude, longitude]` — the order it was
 * originally written against. MapLibre, and therefore every mapcn prop, takes
 * `[longitude, latitude]`.
 *
 * This is the single place the two reconcile, so the swap exists once per
 * direction instead of at every call site. A swapped pair is not a compile
 * error — it silently renders in the wrong hemisphere — which is exactly why it
 * is centralised rather than open-coded.
 */
function toLngLat(coordinates: [number, number]): [number, number] {
  const [latitude, longitude] = coordinates
  return [longitude, latitude]
}

/**
 * A link's arc, carrying its styling so one MapLibre layer can serve them all.
 *
 * `MapArc` renders every datum in a single layer and exposes the rest of the
 * datum as feature properties, read back with `["get", ...]` expressions. That
 * is why colour and emphasis live on the datum rather than in props.
 */
interface FleetArcDatum extends MapArcDatum {
  color: string
  inferred: boolean
  isSelected: boolean
  dimmed: boolean
}

interface FleetLatencyMapProps {
  nodes: FleetMapNode[]
  links: FleetMapLink[]
  /** `[latitude, longitude]` — converted at the map boundary. */
  center: [number, number]
  selectedNodeId?: string | null
  selectedLinkId?: string | null
  onNodeSelect?: (nodeId: string) => void
  onLinkSelect?: (linkId: string) => void
}

export function FleetLatencyMap({
  nodes,
  links,
  center,
  selectedNodeId,
  selectedLinkId,
  onNodeSelect,
  onLinkSelect,
}: FleetLatencyMapProps) {
  // `resolvedTheme` is undefined until next-themes reads the DOM after mount.
  // Treating that as dark keeps the basemap from flashing light on first paint
  // and matches `ThemeProvider`'s default. mapcn can detect this itself, but
  // passing it explicitly keeps one source of truth.
  const { resolvedTheme } = useTheme()
  const theme = resolvedTheme === 'light' ? 'light' : 'dark'

  const arcs: FleetArcDatum[] = links.flatMap((link) => {
    const source = nodes.find((node) => node.nodeId === link.sourceNodeId)
    const target = nodes.find((node) => node.nodeId === link.targetNodeId)
    if (!source || !target) {
      return []
    }

    return [
      {
        id: link.id,
        from: toLngLat(source.coordinates),
        to: toLngLat(target.coordinates),
        color: linkColor(link),
        inferred: link.inferred,
        isSelected: selectedLinkId === link.id,
        dimmed: selectedLinkId !== null && selectedLinkId !== undefined && selectedLinkId !== link.id,
      },
    ]
  })

  return (
    <div className="h-full overflow-hidden rounded-lg border border-slate-200/80 bg-white/70 shadow-sm dark:border-slate-800 dark:bg-slate-950/40">
      <Map
        center={toLngLat(center)}
        zoom={4}
        theme={theme}
        className="h-full w-full"
        // Matches the previous single-world view: without this, a zoomed-out map
        // repeats the world horizontally.
        renderWorldCopies={false}
        scrollZoom
      >
        {/*
          `MapArc` owns the curve — a quadratic Bézier in lng/lat space with the
          antimeridian unwrapped, so an arc crosses via the shorter path. The
          hand-rolled 72-point interpolation this component used to compute, and
          its antimeridian arithmetic, are gone.

          Curvature varies per link so parallel arcs between the same node pair
          fan out instead of overdrawing.
        */}
        <MapArc
          data={arcs}
          curvature={0.18}
          paint={{
            'line-color': ['get', 'color'],
            'line-width': ['case', ['get', 'isSelected'], 3, 1.6],
            'line-opacity': ['case', ['get', 'dimmed'], 0.25, 0.9],
            // Inferred topology edges were dashed before, matching the legend.
            'line-dasharray': ['case', ['get', 'inferred'], ['literal', [6, 5]], ['literal', [1, 0]]],
          }}
          hoverPaint={{
            'line-width': 3,
            'line-opacity': 1,
          }}
          onClick={(event) => {
            const id = event.arc.id
            if (typeof id === 'string') {
              onLinkSelect?.(id)
            }
          }}
        />

        {nodes.map((node) => (
          <MapMarker
            key={node.nodeId}
            longitude={node.coordinates[1]}
            latitude={node.coordinates[0]}
            onClick={() => onNodeSelect?.(node.nodeId)}
          >
            <MarkerContent>
              <span
                className={cn(
                  'inline-flex rounded-full border bg-background p-1 shadow-sm',
                  selectedNodeId === node.nodeId
                    ? 'border-blue-500 text-blue-500 dark:border-blue-400 dark:text-blue-300'
                    : node.isLocal
                      ? 'border-emerald-500 text-emerald-500 dark:border-emerald-400 dark:text-emerald-300'
                      : 'border-slate-400 text-slate-500 dark:border-slate-500 dark:text-slate-300',
                )}
              >
                <CircleDot className="size-4" />
              </span>
            </MarkerContent>
            <MarkerTooltip>
              <div className="space-y-1 text-xs">
                <p className="font-semibold">{node.label}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{node.nodeId}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={node.isLocal ? 'default' : 'secondary'}>{node.isLocal ? 'local' : 'peer'}</Badge>
                  <Badge variant="outline">{node.role}</Badge>
                  <Badge
                    className={cn(
                      'border-transparent',
                      node.lifecycleState === 'healthy'
                        ? 'bg-green-500/20 text-green-700 dark:text-green-300'
                        : 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
                    )}
                  >
                    {node.lifecycleState}
                  </Badge>
                </div>
              </div>
            </MarkerTooltip>
          </MapMarker>
        ))}

        <MapControls position="bottom-right" showZoom showCompass showFullscreen />
      </Map>
    </div>
  )
}
