'use client'

import {
  Map,
  MapMarker,
  MapPolyline,
  MapTileLayer,
  MapTooltip,
  MapZoomControl,
} from '@/components/ui/map'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { cn } from '@repo/ui/lib/utils'
import { CircleDot } from 'lucide-react'

export interface FleetMapNode {
  nodeId: string
  label: string
  role: string
  lifecycleState: string
  sessionState: string
  isLocal: boolean
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

function buildCurvedPositions(
  source: [number, number],
  target: [number, number],
  seedKey: string,
  pairOffset: number,
): [number, number][] {
  const [lat1, lng1] = source
  const [lat2, lng2] = target

  let dLng = lng2 - lng1
  if (dLng > 180) {
    dLng -= 360
  }
  if (dLng < -180) {
    dLng += 360
  }
  const adjustedLng2 = lng1 + dLng

  const distance = Math.hypot(lat2 - lat1, dLng)

  if (distance < 0.00001) {
    return [source, target]
  }

  const seed = stableHash(seedKey)
  const randomDirection = seed % 2 === 0 ? 1 : -1
  const offsetDirection = pairOffset === 0 ? randomDirection : Math.sign(pairOffset)
  const baseArcFactor = 0.11 + (seed % 4) * 0.015
  const siblingFactor = Math.min(0.08, Math.abs(pairOffset) * 0.03)
  const arcAmplitude = distance * (baseArcFactor + siblingFactor) * offsetDirection

  // Great-circle-ish visual arc: linearly interpolate and add sinusoidal bow.
  const points: [number, number][] = []
  const steps = 72
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps
    const arc = Math.sin(Math.PI * t) * arcAmplitude
    const lat = lat1 + (lat2 - lat1) * t + arc
    const lngRaw = lng1 + (adjustedLng2 - lng1) * t
    const lng = lngRaw > 180 ? lngRaw - 360 : lngRaw < -180 ? lngRaw + 360 : lngRaw

    points.push([lat, lng])
  }

  return points
}

interface FleetLatencyMapProps {
  nodes: FleetMapNode[]
  links: FleetMapLink[]
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
  // Force a clean Leaflet remount when center changes significantly,
  // preventing "Map container is being reused by another instance".
  const mapKey = `${Math.round(center[0] * 100)}-${Math.round(center[1] * 100)}`

  return (
    <div className="h-full overflow-hidden rounded-lg border border-slate-200/80 bg-white/70 shadow-sm dark:border-slate-800 dark:bg-slate-950/40">
      <Map key={mapKey} center={center} zoom={4} className="h-full! w-full" scrollWheelZoom preferCanvas>
        <MapTileLayer />
        <MapZoomControl />

        {links.map((link, index) => {
          const source = nodes.find((node) => node.nodeId === link.sourceNodeId)
          const target = nodes.find((node) => node.nodeId === link.targetNodeId)
          if (!source || !target) {
            return null
          }

          const siblings = links.filter(
            (other) => pairKey(other.sourceNodeId, other.targetNodeId) === pairKey(link.sourceNodeId, link.targetNodeId),
          )
          const siblingIndex = siblings.findIndex((other) => other.id === link.id)
          const centeredSiblingOffset = siblingIndex - (siblings.length - 1) / 2

          const color = linkColor(link)
          const curvedPositions = buildCurvedPositions(
            source.coordinates,
            target.coordinates,
            `${source.label}|${target.label}|${String(index)}`,
            centeredSiblingOffset,
          )

          return (
            <MapPolyline
              key={link.id}
              positions={curvedPositions}
              fill={false}
              color={color}
              opacity={selectedLinkId && selectedLinkId !== link.id ? 0.3 : 0.9}
              weight={selectedLinkId === link.id ? 3 : 1.6}
              lineCap="round"
              lineJoin="round"
              dashArray={link.inferred || link.latencyMs > 150 ? '6 5' : undefined}
              eventHandlers={{
                click: () => onLinkSelect?.(link.id),
              }}
            >
              <MapTooltip>
                <div className="space-y-1 text-xs">
                  <p className="font-semibold">{source.label} → {target.label}</p>
                  {link.inferred ? <p className="text-amber-600 dark:text-amber-300">inferred topology edge</p> : null}
                  <p>
                    latency {link.latencyMs}ms · jitter {link.jitterMs}ms · loss {(link.packetLossRatio * 100).toFixed(1)}%
                  </p>
                  <p>
                    reliability {(link.reliabilityScore * 100).toFixed(0)}% · throughput{' '}
                    {Math.round(link.throughputMbps ?? 0)} Mbps
                  </p>
                  <p>state {link.state}</p>
                </div>
              </MapTooltip>
            </MapPolyline>
          )
        })}

        {nodes.map((node) => (
          <MapMarker
            key={node.nodeId}
            position={node.coordinates}
            icon={
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
            }
            eventHandlers={{
              click: () => onNodeSelect?.(node.nodeId),
            }}
          >
            <MapTooltip>
              <div className="space-y-1 text-xs">
                <p className="font-semibold">{node.label}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{node.nodeId}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={node.isLocal ? 'default' : 'secondary'}>{node.isLocal ? 'local' : 'peer'}</Badge>
                  <Badge variant="outline">{node.role}</Badge>
                  <Badge
                    className={cn(
                      'border-transparent',
                      node.lifecycleState === 'healthy' ? 'bg-green-500/20 text-green-700 dark:text-green-300' : 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
                    )}
                  >
                    {node.lifecycleState}
                  </Badge>
                </div>
              </div>
            </MapTooltip>
          </MapMarker>
        ))}
      </Map>
    </div>
  )
}