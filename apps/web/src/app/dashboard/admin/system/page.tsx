'use client'

import { isDefinedORPCError, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useUserList } from '@/domains/user/hooks'
import { useNodeStatus } from '@/domains/setup/hooks'
import { NodeNetworkConfig } from '@/components/dashboard/system/NodeNetworkConfig'
import {
  useFleetAdmissionRequests,
  useDeleteFleetAllocation,
  useFleetAllocations,
  useFleetServers,
  useResolveFleetAdmissionRequest,
  useSetFleetServerCapacity,
  useUpsertFleetAllocation,
} from '@/domains/fleet/hooks'
import {
  useConnectMeshPeer,
  useDisconnectMeshPeer,
  useLookupMeshResource,
  useMeshEventStreams,
  useMeshSseState,
  useMeshTrustKeyringConvergenceStatus,
  useMeshTrustKeyringRotate,
  useMeshTrustKeyringSecrets,
  useMeshTrustKeyringStatus,
  useMeshTrustStrictModeSet,
  useMeshTrustStrictReadiness,
  useMeshTrustStrictRollback,
  useMeshTrustStrictRolloutPlan,
  useMeshNodeConfig,
  useMeshUpdateNodeConfig,
  useMeshRegenerateNodeConfigSecret,
  useMeshTestNodeConfigDb,
  usePlanMeshStreamRoute,
} from '@/domains/mesh/hooks'
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Node,
} from '@xyflow/react'
import '@/assets/css/xyflow.css'
import {
  buildMeshEndpointUrl,
  buildRemoteSignInUrl,
  detectRemoteServer,
  fetchRemoteAuthSession,
  normalizeServerHttpUrl,
} from '@/domains/mesh/connect-flow'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { Progress } from '@repo/ui/components/shadcn/progress'
import { Label } from '@repo/ui/components/shadcn/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/shadcn/table'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Textarea } from '@repo/ui/components/shadcn/textarea'
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Cpu,
  Globe,
  Inbox,
  Key,
  Network,
  PlugZap,
  RefreshCw,
  Server,
  Settings,
  Shield,
  ShieldAlert,
  Sliders,
  Unplug,
  Users,
  XCircle,
} from 'lucide-react'
import type { MeshNodeRole, MeshRoutingMode, MeshPartitionConsistencyMode } from '@repo/contracts-entities'
import Image from 'next/image'
import { toast } from 'sonner'
import { PageHeader, StatStrip, StatStripItem } from '@/components/dashboard'
import { AuthDashboardAdminUsers, AuthDashboardNodesNodeId } from '@/routes'
import { formatDate, formatDateTime, formatTime } from '@/lib/format/date'
import { useHydrated } from '@/lib/use-hydrated'

/**
 * Heading for the content of a tab.
 *
 * Each tab used to open with a Card that wrapped a grid of Cards. The outer box
 * existed only to group its children — and every child already draws its own
 * border — so the tab rendered a frame inside a frame, with the group's heading
 * demoted to a 14px card title above a second 16px card title. A heading groups
 * the section without drawing a second box around it.
 */
function SectionIntro({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

/**
 * A count inside a tab trigger.
 *
 * The tabs used to be silent, so the only way to find out that admission
 * requests were waiting was to open the one tab that lists them. Nothing is
 * rendered for `undefined` or `0`: an unloaded total must not read as "none",
 * and a zero badge is noise on every tab of an empty install.
 *
 * `attention` marks a count that represents queued work — the one kind of
 * number in a tab strip that is asking to be acted on.
 */
function TabCount({
  value,
  attention = false,
}: {
  value: number | undefined
  attention?: boolean
}) {
  if (value === undefined || value === 0) return null
  return (
    <span
      className={
        attention
          ? 'ml-0.5 rounded-full bg-status-pending/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-status-pending'
          : 'ml-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground'
      }
    >
      {value}
    </span>
  )
}

/**
 * Utilisation percentage → the colour of its bar.
 *
 * Both capacity bars carried their own copy of this threshold logic and named
 * literal colours (`bg-red-500`), while the rest of this file already reads the
 * palette's `status-*` tokens. One function, one threshold pair, and the theme
 * keeps ownership of what "nearly full" looks like.
 *
 * `null` means the node publishes no limit (its capacity is unbounded), which
 * is a different state from "empty" and is drawn as such.
 */
function utilisationIndicatorClass(pct: number | null): string {
  if (pct === null) return '*:data-[slot=progress-indicator]:bg-status-idle'
  if (pct >= 90) return '*:data-[slot=progress-indicator]:bg-status-danger'
  if (pct >= 70) return '*:data-[slot=progress-indicator]:bg-status-pending'
  return '*:data-[slot=progress-indicator]:bg-status-live'
}

type MeshRoutePlanHistoryEntry = {
  at: string
  streamId: string
  selected: number
  candidates: number
  topOwner: string | null
}

type MeshLookupHistoryEntry = {
  at: string
  kind: 'stream' | 'queue' | 'deployment' | 'log'
  key: string
  found: boolean
  owner: string | null
  candidates: number
}

export default function AdminSystemPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  /**
   * Every figure in the summary strip comes from a client query, so none of them
   * can be known while the server renders this page. Gating them on `hydrated`
   * keeps the server HTML and the client's first render identical — otherwise the
   * server writes an em dash, a warm client cache writes a number, and React
   * throws the subtree away and re-renders it.
   */
  const hydrated = useHydrated()
  const pendingInvitations = [] as Array<{ id: string; email: string; role: string; status: string; expiresAt: string }>
  
  // Use domain-based user hooks
  const { data: usersData, isLoading: usersLoadingRaw } = useUserList({
    query: {
      limit: 100,
      offset: 0,
    },
  })
  
  // Note: userQueryKeys can be used for manual cache operations:
  // queryClient.invalidateQueries({ queryKey: userQueryKeys.list() })
  // queryClient.prefetchQuery({ queryKey: userQueryKeys.list({ limit: 100 }), ... })

  const users = usersData?.data ?? []
  const { data: fleetServersData, isLoading: fleetServersLoadingRaw } = useFleetServers()
  const { data: fleetAllocationsData, isLoading: fleetAllocationsLoadingRaw } = useFleetAllocations()
  const [admissionRequestStatusFilter, setAdmissionRequestStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'cancelled'>('pending')

  const [reviewerNote, setReviewerNote] = useState('')
  const [decisionServerNodeId, setDecisionServerNodeId] = useState('')
  const { data: fleetAdmissionRequestsData, isLoading: fleetAdmissionRequestsLoadingRaw } = useFleetAdmissionRequests({
    status: admissionRequestStatusFilter,
  })
  /**
   * The summary strip is page-level, but the admission list below is filtered by
   * a control INSIDE the Fleet tab. Reading the strip's count off the filtered
   * list would relabel approved or rejected requests as "awaiting approval" the
   * instant that filter changed, so it gets its own pending-only query. When the
   * tab filter is already `pending` the query keys match and TanStack serves
   * both from one fetch.
   */
  const { data: pendingAdmissionsData } = useFleetAdmissionRequests({ status: 'pending' })
  const upsertFleetAllocation = useUpsertFleetAllocation()
  const deleteFleetAllocation = useDeleteFleetAllocation()
  const resolveFleetAdmissionRequest = useResolveFleetAdmissionRequest()
  const setFleetServerCapacity = useSetFleetServerCapacity()

  const [capacityEditNodeId, setCapacityEditNodeId] = useState<string | null>(null)
  const [capacityEditMaxCpu, setCapacityEditMaxCpu] = useState('')
  const [capacityEditMaxMem, setCapacityEditMaxMem] = useState('')

  const { state: meshState, status: meshStreamStatus, lastError: meshStreamError } = useMeshSseState()

  // Trust & security hooks
  const { data: nodeStatus, isLoading: nodeStatusLoading } = useNodeStatus()
  const { data: trustKeyring, isLoading: trustKeyringLoading } = useMeshTrustKeyringStatus()
  const { data: trustSecrets, isLoading: trustSecretsLoading } = useMeshTrustKeyringSecrets({ enabled: false })
  const rotateKey = useMeshTrustKeyringRotate()
  const { data: keyringConvergence, isLoading: keyringConvergenceLoading } = useMeshTrustKeyringConvergenceStatus()
  const { data: strictReadiness, isLoading: strictReadinessLoadingRaw } = useMeshTrustStrictReadiness()
  const setStrictMode = useMeshTrustStrictModeSet()
  const { data: rolloutPlan, isLoading: rolloutPlanLoading } = useMeshTrustStrictRolloutPlan({ enabled: false })
  const rollbackStrict = useMeshTrustStrictRollback()

  const connectPeer = useConnectMeshPeer()
  const disconnectPeer = useDisconnectMeshPeer()
  const planStreamRoute = usePlanMeshStreamRoute()
  const lookupResource = useLookupMeshResource()
  const { data: meshEventStreamsData, isLoading: meshEventStreamsLoading } = useMeshEventStreams({
    query: {
      limit: 25,
      offset: 0,
    },
  })

  const [serverUrl, setServerUrl] = useState('')
  const [handshakeInProgress, setHandshakeInProgress] = useState(false)
  const [streamIdForRoute, setStreamIdForRoute] = useState('')
  const [desiredRouteBranches, setDesiredRouteBranches] = useState(2)
  const [lookupKind, setLookupKind] = useState<'stream' | 'queue' | 'deployment' | 'log'>('stream')
  const [lookupKey, setLookupKey] = useState('')

  const [allocationServerNodeId, setAllocationServerNodeId] = useState('')
  const [allocationMode, setAllocationMode] = useState<'dedicated_full' | 'dedicated_slice' | 'shared_slice'>('shared_slice')
  const [allocationCpuMillicores, setAllocationCpuMillicores] = useState(1000)
  const [allocationMemoryMb, setAllocationMemoryMb] = useState(1024)
  const [allocationMaxServices, setAllocationMaxServices] = useState<number | null>(null)
  const [routePlanHistory, setRoutePlanHistory] = useState<MeshRoutePlanHistoryEntry[]>([])
  const [lookupHistory, setLookupHistory] = useState<MeshLookupHistoryEntry[]>([])

  // Node config hooks
  const { data: nodeConfig, isLoading: nodeConfigLoading } = useMeshNodeConfig()
  const updateNodeConfig = useMeshUpdateNodeConfig()
  const regenerateSecret = useMeshRegenerateNodeConfigSecret()
  const testDb = useMeshTestNodeConfigDb()

  // ── Node Config state ─────────────────────────────────────────────────────
  const [showSecrets, setShowSecrets] = useState(false)
  const [strictEnabled, setStrictEnabled] = useState(false)
  const [rotateKeyId, setRotateKeyId] = useState('')
  const [rotateSecret, setRotateSecret] = useState('')
  const [showRotateForm, setShowRotateForm] = useState(false)
  const [editNodeId, setEditNodeId] = useState('')
  const [editStrategy, setEditStrategy] = useState<'local' | 'remote'>('local')
  const [editMeshUrls, setEditMeshUrls] = useState('')
  const [editDatabaseUrl, setEditDatabaseUrl] = useState('')
  const [editRegion, setEditRegion] = useState('')
  const [editZone, setEditZone] = useState('')
  const [editVersion, setEditVersion] = useState('')
  const [editRoles, setEditRoles] = useState('')
  const [editRoutingMode, setEditRoutingMode] = useState('')
  const [editConsistencyMode, setEditConsistencyMode] = useState('')
  const [testDbUrl, setTestDbUrl] = useState('')
  const [testDbResult, setTestDbResult] = useState<{ connected: boolean; isNewDatabase?: boolean | null; error?: string | null } | null>(null)
  const [showConfigForm, setShowConfigForm] = useState(false)
  const [showSecretResult, setShowSecretResult] = useState<string | null>(null)

  // Sync strict mode toggle with actual state
  useEffect(() => {
    if (strictReadiness) {
      setStrictEnabled(strictReadiness.strictEnforced)
    }
  }, [strictReadiness])

  const peers = meshState?.peers ?? []
  const sessions = meshState?.sessions ?? []
  const fleetServers = fleetServersData?.items ?? []
  const fleetAllocations = fleetAllocationsData?.items ?? []
  const fleetAdmissionRequests = fleetAdmissionRequestsData?.items ?? []
  const pendingAdmissions = pendingAdmissionsData?.items ?? []
  const localNode = meshState?.localNode
  const snapshotData = meshState?.snapshot
  const meshEventStreams = meshEventStreamsData?.data ?? []
  const activeMeshEventStreams = meshEventStreams.filter((stream) => stream.isActive).length

  /**
   * Hydration-aware loading flags.
   *
   * Every list and figure on this page comes from a CLIENT query, so the server
   * renders with an empty cache: `isLoading` is true there and false on a warm
   * client. A render branch keyed on the raw flag therefore emits a skeleton into
   * the server HTML and real rows in the client's first render, and React reports
   * "server rendered HTML didn't match the client" before discarding the subtree.
   *
   * Folding `!hydrated` into each flag fixes every branch at once instead of
   * per-branch, and keeps the two renders identical by construction: during SSR
   * and the first client pass both sides take the loading path.
   */
  const usersLoading = !hydrated || usersLoadingRaw
  const fleetServersLoading = !hydrated || fleetServersLoadingRaw
  const fleetAllocationsLoading = !hydrated || fleetAllocationsLoadingRaw
  const fleetAdmissionRequestsLoading = !hydrated || fleetAdmissionRequestsLoadingRaw
  const strictReadinessLoading = !hydrated || strictReadinessLoadingRaw
  const isMeshStateLoading = !hydrated || (meshStreamStatus === 'connecting' && !meshState)

  const surfaceCardClass =
    'border-border/60 bg-card/40 backdrop-blur-xl'

  const topologyNodes = useMemo(() => {
    const local = localNode
      ? [{
          nodeId: localNode.nodeId,
          lifecycleState: localNode.lifecycleState,
          isLocal: true,
        }]
      : []

    const remotes = (snapshotData?.nodes ?? []).map((node) => ({
      nodeId: node.nodeId,
      lifecycleState: node.lifecycleState,
      isLocal: false,
    }))

    return [...local, ...remotes]
  }, [localNode, snapshotData])

  const graphLayout = useMemo(() => {
    const width = 760
    const height = 420
    const centerX = width / 2
    const centerY = height / 2
    const radius = Math.max(90, Math.min(165, 24 * topologyNodes.length))

    const positionedNodes = topologyNodes.map((node, index) => {
      const angle = (2 * Math.PI * index) / Math.max(1, topologyNodes.length)
      return {
        ...node,
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      }
    })

    const positionedEdges = peers
      .map((edge) => {
        const source = positionedNodes.find((node) => node.nodeId === edge.sourceNodeId)
        const target = positionedNodes.find((node) => node.nodeId === edge.targetNodeId)
        if (!source || !target) return null
        return { edge, source, target }
      })
      .filter((edge): edge is NonNullable<typeof edge> => edge !== null)

    return {
      width,
      height,
      nodes: positionedNodes,
      edges: positionedEdges,
    }
  }, [peers, topologyNodes])

  const flowNodes = useMemo<Node[]>(() => {
    return graphLayout.nodes.map((node) => {
      const nodeColor = node.isLocal
        ? '#3b82f6'
        : node.lifecycleState === 'healthy'
          ? '#22c55e'
          : node.lifecycleState === 'suspect'
            ? '#f59e0b'
            : '#ef4444'

      return {
        id: node.nodeId,
        type: 'default',
        draggable: false,
        selectable: false,
        position: {
          x: node.x,
          y: node.y,
        },
        data: {
          label: (
            <div className="rounded border bg-background px-2 py-1 shadow-sm min-w-27.5 text-center">
              <p className="text-[10px] font-semibold font-mono break-all">{node.nodeId.slice(0, 8)}</p>
              <p className="text-[10px] text-muted-foreground">{node.isLocal ? 'local' : node.lifecycleState}</p>
            </div>
          ),
        },
        style: {
          border: `2px solid ${nodeColor}`,
          borderRadius: 8,
          background: '#0b1020',
          color: '#e5e7eb',
          width: 124,
          minHeight: 44,
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        },
      }
    })
  }, [graphLayout.nodes])

  const flowEdges = useMemo<Edge[]>(() => {
    return graphLayout.edges.map(({ edge, source, target }) => ({
      id: edge.connectionId,
      source: source.nodeId,
      target: target.nodeId,
      type: 'smoothstep',
      animated: edge.state === 'degraded',
      markerEnd: {
        type: MarkerType.ArrowClosed,
      },
      label: `w=${edge.metrics.weight.toFixed(3)}`,
      style: {
        stroke: edge.state === 'up' ? '#22c55e' : edge.state === 'degraded' ? '#f59e0b' : '#ef4444',
        strokeWidth: Math.max(1, 5 - Math.min(4, edge.metrics.weight * 8)),
      },
    }))
  }, [graphLayout.edges])

  const callbackHandshakeUrl = useMemo(() => {
    if (typeof window === 'undefined') {
      return null
    }

    const current = new URL(window.location.href)
    current.searchParams.delete('meshAuthReturn')
    current.searchParams.delete('meshServer')
    return current
  }, [])

  useEffect(() => {
    const firstServer = fleetServers.at(0)
    if (!allocationServerNodeId && firstServer) {
      setAllocationServerNodeId(firstServer.nodeId)
    }
  }, [allocationServerNodeId, fleetServers])

  useEffect(() => {
    const shouldFinalize = searchParams.get('meshAuthReturn') === '1'
    const rawServer = searchParams.get('meshServer')

    if (!shouldFinalize || !rawServer || handshakeInProgress) {
      return
    }

    let cancelled = false

    const finalizeHandshake = async () => {
      setHandshakeInProgress(true)

      try {
        const normalizedServerUrl = normalizeServerHttpUrl(rawServer)
        const remoteAuthSession = await fetchRemoteAuthSession(normalizedServerUrl)

        await connectPeer.mutateAsync({
          serverUrl: normalizedServerUrl,
          endpointUrl: buildMeshEndpointUrl(normalizedServerUrl),
          remoteAuthSession,
          metadata: {
            authFlow: 'remote-signin-handoff',
          },
        })

        if (!cancelled) {
          toast.success('Remote session retrieved and peer connection requested with authenticated context.')
          router.replace('/dashboard/admin/system')
        }
      } catch (error) {
        if (!cancelled) {
          const message = isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown mesh auth handoff error'
          toast.error(`Unable to complete remote auth handoff: ${message}`)
          router.replace('/dashboard/admin/system')
        }
      } finally {
        if (!cancelled) {
          setHandshakeInProgress(false)
        }
      }
    }

    void finalizeHandshake()

    return () => {
      cancelled = true
    }
  }, [connectPeer, handshakeInProgress, router, searchParams])

  const handleConnectPeer = async () => {
    const trimmedServerUrl = serverUrl.trim()

    if (!trimmedServerUrl) {
      toast.error('HTTP server URL is required to connect a peer')
      return
    }

    try {
      const normalizedServerUrl = normalizeServerHttpUrl(trimmedServerUrl)
      await detectRemoteServer(normalizedServerUrl)

      if (!callbackHandshakeUrl) {
        throw new Error('Unable to build callback URL in current environment')
      }

      callbackHandshakeUrl.searchParams.set('meshAuthReturn', '1')
      callbackHandshakeUrl.searchParams.set('meshServer', normalizedServerUrl)

      const signInUrl = buildRemoteSignInUrl(normalizedServerUrl, callbackHandshakeUrl.toString())

      toast.success('Remote server detected. Redirecting to remote login...')
      window.location.assign(signInUrl)
    } catch (error) {
      const message = isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown mesh connect preflight error'
      toast.error(`Failed to start remote auth handshake: ${message}`)
    }
  }

  const handleDisconnectPeer = async (sessionId: string) => {
    try {
      await disconnectPeer.mutateAsync({
        params: { sessionId },
        body: {
          allowReconnect: false,
          reason: 'manual-instance-unlink',
        },
      })
      toast.success('Peer session disconnect requested')
    } catch (error) {
      const message = isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown mesh disconnect error'
      toast.error(`Failed to disconnect peer: ${message}`)
    }
  }

  const handlePlanStreamRoute = async () => {
    const trimmed = streamIdForRoute.trim()
    if (!trimmed) {
      toast.error('A stream id is required to plan mesh route branches')
      return
    }

    try {
      const result = await planStreamRoute.mutateAsync({
        streamId: trimmed,
        desiredBranches: Math.min(6, Math.max(1, desiredRouteBranches)),
        includeCandidates: true,
      })

      setRoutePlanHistory((previous) => [
        {
          at: new Date().toISOString(),
          streamId: trimmed,
          selected: result.selected.length,
          candidates: result.candidates.length,
          topOwner: result.selected[0]?.ownerNodeId ?? null,
        },
        ...previous,
      ].slice(0, 8))

      toast.success('Computed stream route plan from mesh resource index')
    } catch (error) {
      const message = isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown route planning error'
      toast.error(`Unable to plan stream route: ${message}`)
    }
  }

  const handleLookupResource = async () => {
    const trimmed = lookupKey.trim()
    if (!trimmed) {
      toast.error('A resource key is required for mesh ownership lookup')
      return
    }

    try {
      const result = await lookupResource.mutateAsync({
        kind: lookupKind,
        key: trimmed,
        includeCandidates: true,
      })

      setLookupHistory((previous) => [
        {
          at: new Date().toISOString(),
          kind: lookupKind,
          key: trimmed,
          found: result.found,
          owner: result.primary?.ownerNodeId ?? null,
          candidates: result.candidates.length,
        },
        ...previous,
      ].slice(0, 8))

      if (result.found) {
        toast.success('Mesh ownership lookup resolved a primary location')
      } else {
        toast.warning('No mesh ownership location found for this resource key')
      }
    } catch (error) {
      const message = isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown ownership lookup error'
      toast.error(`Unable to lookup resource ownership: ${message}`)
    }
  }

  const handleUpsertFleetAllocation = async () => {
    if (!allocationServerNodeId) {
      toast.error('Select a server first')
      return
    }

    try {
      await upsertFleetAllocation.mutateAsync({
        serverNodeId: allocationServerNodeId,
        allocationMode,
        cpuMillicores: Math.max(0, allocationCpuMillicores),
        memoryMb: Math.max(0, allocationMemoryMb),
        maxServices: allocationMaxServices,
        isEnabled: true,
      })

      toast.success('Server capacity allocation saved')
    } catch (error) {
      const message = isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown allocation error'
      toast.error(`Failed to save allocation: ${message}`)
    }
  }

  const handleDeleteFleetAllocation = async (serverNodeId: string) => {
    try {
      await deleteFleetAllocation.mutateAsync({ serverNodeId })
      toast.success('Allocation removed')
    } catch (error) {
      const message = isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown deletion error'
      toast.error(`Failed to remove allocation: ${message}`)
    }
  }

  const handleResolveAdmissionRequest = async (requestId: string, decision: 'approved' | 'rejected') => {
    const trimmedReviewerNote = reviewerNote.trim()
    const trimmedDecisionServerNodeId = decisionServerNodeId.trim()

    try {
      await resolveFleetAdmissionRequest.mutateAsync({
        requestId,
        decision,
        reviewerNote: trimmedReviewerNote === '' ? null : trimmedReviewerNote,
        decisionServerNodeId: trimmedDecisionServerNodeId === '' ? null : trimmedDecisionServerNodeId,
      })
      toast.success(`Admission request ${decision}`)
    } catch (error) {
      const message = isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown request resolution error'
      toast.error(`Failed to resolve admission request: ${message}`)
    }
  }

  // ── Trust / Strict Mode Handlers ──────────────────────────────────────────

  const handleToggleStrictMode = async (enabled: boolean) => {
    try {
      await setStrictMode.mutateAsync({ enabled })
      setStrictEnabled(enabled)
      toast.success(enabled ? 'Strict mode enabled' : 'Strict mode disabled')
    } catch (error) {
      const message = isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown error'
      toast.error(`Failed to toggle strict mode: ${message}`)
    }
  }

  const handleRotateKey = async () => {
    try {
      await rotateKey.mutateAsync({
        keyId: rotateKeyId.trim() || undefined,
        secretMaterial: rotateSecret.trim() || undefined,
      })
      setShowRotateForm(false)
      setRotateKeyId('')
      setRotateSecret('')
      toast.success('Trust keyring rotated')
    } catch (error) {
      const message = isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown error'
      toast.error(`Failed to rotate key: ${message}`)
    }
  }

  const handleRollbackStrict = async () => {
    try {
      await rollbackStrict.mutateAsync({ force: false })
      toast.success('Strict mode rollback initiated')
    } catch (error) {
      const message = isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown error'
      toast.error(`Failed to rollback strict mode: ${message}`)
    }
  }

  // ── Node Config Handlers ────────────────────────────────────────────────

  const handleSaveNodeConfig = async () => {
    try {
      await updateNodeConfig.mutateAsync({
        nodeId: editNodeId.trim() || undefined,
        strategy: editStrategy,
        meshUrlsSnapshot: editMeshUrls.trim() ? editMeshUrls.split('\n').map((s) => s.trim()).filter(Boolean) : undefined,
        databaseUrl: editDatabaseUrl.trim() || null,
        region: editRegion.trim() || null,
        zone: editZone.trim() || null,
        version: editVersion.trim() || null,
        roles: editRoles.trim() ? editRoles.split(',').map((s) => s.trim()).filter(Boolean) as MeshNodeRole[] : null,
        routingMode: (editRoutingMode || null) as MeshRoutingMode | null,
        consistencyMode: (editConsistencyMode || null) as MeshPartitionConsistencyMode | null,
      })
      setShowConfigForm(false)
      toast.success('Node configuration updated')
    } catch (error) {
      const message = isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown error'
      toast.error(`Failed to update config: ${message}`)
    }
  }

  const handleRegenerateSecret = async () => {
    try {
      const result = await regenerateSecret.mutateAsync({})
      setShowSecretResult(result.meshSharedSecret)
      toast.success('Mesh shared secret regenerated')
    } catch (error) {
      const message = isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown error'
      toast.error(`Failed to regenerate secret: ${message}`)
    }
  }

  const handleTestDbConnection = async () => {
    if (!testDbUrl.trim()) return
    try {
      const result = await testDb.mutateAsync({ databaseUrl: testDbUrl.trim() })
      setTestDbResult(result)
      if (result.connected) {
        toast.success('Database connection successful')
      } else {
        toast.error(result.error ?? 'Connection failed')
      }
    } catch (error) {
      const message = isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown error'
      setTestDbResult({ connected: false, error: message })
      toast.error(`Database test failed: ${message}`)
    }
  }

  const shortId = (id: string | undefined | null, len = 8): string => {
    if (!id) return '—'
    return id.length > len ? id.slice(0, len) : id
  }

  return (
    <div className="container mx-auto max-w-360 py-6 space-y-6">
        {/* ── Header ────────────────────────────────────────────────────── */}
        <PageHeader
          eyebrow="Admin"
          title="System Dashboard"
          description="Mesh topology, fleet capacity, directory, and node configuration"
          badge={
            <Badge variant={meshStreamStatus === 'connected' ? 'default' : meshStreamStatus === 'error' ? 'destructive' : 'secondary'}>
              {meshStreamStatus}
            </Badge>
          }
        />
        {/*
          Ordered by what an operator can act on, not by what is easiest to
          count. "Awaiting approval" leads because it is the only value here
          that represents work queued for a human decision; the totals follow.
          The stream state is set apart on the right, because it is the one
          value that can be *wrong* and should not read as one more total.

          `undefined` while loading renders an em dash rather than 0: "not
          measured yet" and "none" are different facts, and only one of them
          means nothing needs doing.
        */}
        <StatStrip
          trailing={
            meshStreamError ? (
              <Badge variant="destructive" className="gap-1.5">
                <AlertCircle className="h-3.5 w-3.5" />
                {meshStreamError}
              </Badge>
            ) : undefined
          }
        >
          <StatStripItem
            icon={Inbox}
            label="Awaiting approval"
            value={hydrated ? pendingAdmissions.length : undefined}
            hint={
              hydrated
                ? pendingAdmissions.length === 0
                  ? 'nothing queued'
                  : 'needs a decision'
                : undefined
            }
            tone={hydrated && pendingAdmissions.length > 0 ? 'pending' : undefined}
          />
          <StatStripItem
            icon={Server}
            label="Servers"
            value={hydrated ? fleetServers.length : undefined}
            hint={
              hydrated
                ? `${String(fleetServers.filter((s) => s.healthy).length)} healthy`
                : undefined
            }
          />
          <StatStripItem
            icon={Cpu}
            label="Capacity allocations"
            value={hydrated ? fleetAllocations.length : undefined}
          />
          <StatStripItem
            icon={Network}
            label="Peers"
            value={hydrated ? peers.length : undefined}
            hint={
              hydrated ? `${String(peers.filter((p) => p.state === 'up').length)} up` : undefined
            }
          />
          <StatStripItem
            icon={Users}
            label="Users"
            value={hydrated ? users.length : undefined}
          />
          <StatStripItem
            icon={Shield}
            label="Strict keyring"
            value={
              hydrated
                ? strictReadiness?.strictConfigured
                  ? strictReadiness.strictEnforced
                    ? 'On'
                    : 'Off'
                  : 'Not configured'
                : undefined
            }
          />
        </StatStrip>

        {/* ── Tabs ──────────────────────────────────────────────────────── */}
        {/*
          No `orientation="vertical"` here: the list is laid out horizontally,
          and the vertical orientation only changes which arrow keys move
          between tabs — so it made ←/→ dead and ↑/↓ jump the page instead.
        */}
        <Tabs defaultValue="fleet" className="space-y-4">
          <TabsList className="inline-flex w-full md:w-auto">
            <TabsTrigger value="fleet" className="gap-2">
              <Server className="h-4 w-4" />
              Fleet & Capacity
              <TabCount value={hydrated ? pendingAdmissions.length : undefined} attention />
            </TabsTrigger>
            <TabsTrigger value="mesh" className="gap-2">
              <Network className="h-4 w-4" />
              Mesh & Routing
              <TabCount value={hydrated ? peers.length : undefined} />
            </TabsTrigger>
            <TabsTrigger value="directory" className="gap-2">
              <Building2 className="h-4 w-4" />
              Directory
              <TabCount value={hydrated ? users.length : undefined} />
            </TabsTrigger>
            <TabsTrigger value="node-config" className="gap-2">
              <Settings className="h-4 w-4" />
              Node Configuration
            </TabsTrigger>
          </TabsList>

        <TabsContent value="fleet" className="space-y-4">
          <SectionIntro
            title="Capacity"
            description="Assign CPU and memory to each node. Every service keeps its own database."
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Connected Servers</CardTitle>
              </CardHeader>
              <CardContent>
                {fleetServersLoading ? (
                  <div className="space-y-2">
                    {[1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
                  </div>
                ) : fleetServers.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-10 text-center">
                    <Server className="h-10 w-10 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">No fleet servers registered yet.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {fleetServers.map((server) => {
                      const isEditingCapacity = capacityEditNodeId === server.nodeId
                      const usedCpu = server.allocationSummary.cpuMillicores
                      const usedMem = server.allocationSummary.memoryMb
                      const maxCpu = server.maxCpuMillicores
                      const maxMem = server.maxMemoryMb
                      const cpuPct = maxCpu != null && maxCpu > 0 ? Math.min(100, Math.round((usedCpu / maxCpu) * 100)) : null
                      const memPct = maxMem != null && maxMem > 0 ? Math.min(100, Math.round((usedMem / maxMem) * 100)) : null

                      return (
                        <div key={server.nodeId} className="rounded-lg border bg-card p-3 space-y-2 shadow-xs">
                          <div className="flex items-start justify-between">
                            <div className="min-w-0 flex-1">
                              {/*
                                The id was inert text. It is now the way into that
                                node's workspace, which is where its history,
                                metrics and per-node settings live — the things
                                this card cannot show. Truncated ids were
                                previously unresolvable from here: you could see
                                four servers but had no route to any of them.
                              */}
                              <AuthDashboardNodesNodeId.Link
                                nodeId={server.nodeId}
                                className="font-mono text-sm truncate block hover:underline"
                                title={server.nodeId}
                              >
                                {server.nodeId}
                              </AuthDashboardNodesNodeId.Link>
                              <p className="text-xs text-muted-foreground truncate" title={server.serverUrl}>{server.serverUrl}</p>
                            </div>
                            <div className="flex items-center gap-1.5 ml-2 shrink-0">
                              <Badge variant={server.healthy ? 'default' : 'destructive'} className="text-[10px] h-5">
                                {server.healthy ? 'healthy' : 'unhealthy'}
                              </Badge>
                              <Badge variant="secondary" className="text-[10px] h-5">{server.status}</Badge>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-xs">
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">CPU</span>
                                <span className="font-medium tabular-nums">
                                  {cpuPct != null ? `${String(cpuPct)}%` : 'N/A'}
                                </span>
                              </div>
                              <Progress
                                value={cpuPct ?? 0}
                                aria-label="CPU utilisation"
                                className={`h-1.5 ${utilisationIndicatorClass(cpuPct)}`}
                              />
                              <p className="text-muted-foreground">{String(usedCpu)}m / {maxCpu != null ? `${String(maxCpu)}m` : '∞'}</p>
                            </div>
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">RAM</span>
                                <span className="font-medium tabular-nums">
                                  {memPct != null ? `${String(memPct)}%` : 'N/A'}
                                </span>
                              </div>
                              <Progress
                                value={memPct ?? 0}
                                aria-label="Memory utilisation"
                                className={`h-1.5 ${utilisationIndicatorClass(memPct)}`}
                              />
                              <p className="text-muted-foreground">{String(usedMem)}MB / {maxMem != null ? `${String(maxMem)}MB` : '∞'}</p>
                            </div>
                          </div>
                          {server.allocationSummary.services > 0 && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Globe className="h-3 w-3" />
                              <span>{server.allocationSummary.services} allocation(s)</span>
                            </div>
                          )}
                          {isEditingCapacity ? (
                            <div className="flex items-center gap-1 mt-1">
                              <Input
                                className="h-7 text-xs"
                                type="number"
                                min={1}
                                value={capacityEditMaxCpu}
                                onChange={(e) => { setCapacityEditMaxCpu(e.target.value) }}
                                placeholder="Max CPU (m)"
                                aria-label={`Max CPU millicores for ${server.nodeId.slice(0, 8)}`}
                              />
                              <Input
                                className="h-7 text-xs"
                                type="number"
                                min={1}
                                value={capacityEditMaxMem}
                                onChange={(e) => { setCapacityEditMaxMem(e.target.value) }}
                                placeholder="Max RAM (MB)"
                                aria-label={`Max memory MB for ${server.nodeId.slice(0, 8)}`}
                              />
                              <Button
                                type="button"
                                size="sm"
                                className="h-7 text-xs"
                                disabled={setFleetServerCapacity.isPending}
                                onClick={() => {
                                  const maxCpuVal = capacityEditMaxCpu.trim() === '' ? null : Number(capacityEditMaxCpu)
                                  const maxMemVal = capacityEditMaxMem.trim() === '' ? null : Number(capacityEditMaxMem)
                                  setFleetServerCapacity.mutate(
                                    { serverNodeId: server.nodeId, maxCpuMillicores: maxCpuVal, maxMemoryMb: maxMemVal },
                                    {
                                      onSuccess: () => {
                                        setCapacityEditNodeId(null)
                                        toast.success('Capacity limits updated')
                                      },
                                      onError: (err) => { toast.error(isDefinedORPCError(err) ? getErrorMessage(err, 'Failed to update capacity') : 'Failed to update capacity') },
                                    },
                                  )
                                }}
                              >
                                {setFleetServerCapacity.isPending ? 'Saving…' : 'Save'}
                              </Button>
                              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setCapacityEditNodeId(null) }}>Cancel</Button>
                            </div>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-6 text-xs mt-1"
                              onClick={() => {
                                setCapacityEditNodeId(server.nodeId)
                                setCapacityEditMaxCpu(server.maxCpuMillicores != null ? String(server.maxCpuMillicores) : '')
                                setCapacityEditMaxMem(server.maxMemoryMb != null ? String(server.maxMemoryMb) : '')
                              }}
                            >
                              Set capacity limits
                            </Button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Assign Capacity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/*
                  Every control here was named by its placeholder, so the moment
                  a value was typed the field's meaning disappeared. They have
                  real labels now — and the mode select no longer announces
                  itself to a screen reader as "shared_slice", which is a value,
                  not a name.
                */}
                <div className="space-y-1">
                  <Label htmlFor="alloc-server" className="text-xs text-muted-foreground">
                    Fleet server
                  </Label>
                  <select id="alloc-server"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-50"
                    value={allocationServerNodeId}
                    disabled={!hydrated}
                    onChange={(event) => {
                      setAllocationServerNodeId(event.target.value)
                    }}
                  >
                    <option value="">Select server</option>
                    {/*
                      The option carries what the choice is actually about —
                      headroom on that machine. The hostname was here before, but
                      it is already printed on the server's own card above, while
                      "how much is left" appeared nowhere in this form.

                      Gated on `hydrated`: `fleetServers` is empty while the server
                      renders (no query cache) and populated in the browser, so
                      emitting these options unconditionally gave React a <select>
                      with one option in the server HTML and several in the
                      client's first render — the "server rendered HTML didn't
                      match the client" mismatch. The select stays disabled until
                      the list is real, so it cannot be opened against an empty set.
                    */}
                    {hydrated
                      ? fleetServers.map((server) => {
                          const usedCpu = server.allocationSummary.cpuMillicores
                          const maxCpu = server.maxCpuMillicores
                          return (
                            <option key={server.nodeId} value={server.nodeId}>
                              {server.displayName ?? server.nodeId.slice(0, 8)}
                              {' · '}
                              {maxCpu != null
                                ? `${String(usedCpu)} / ${String(maxCpu)}m CPU used`
                                : `${String(usedCpu)}m CPU used, no limit set`}
                            </option>
                          )
                        })
                      : null}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="alloc-mode" className="text-xs text-muted-foreground">
                    Allocation mode
                  </Label>
                  <select id="alloc-mode"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={allocationMode}
                    onChange={(event) => {
                      setAllocationMode(event.target.value as 'dedicated_full' | 'dedicated_slice' | 'shared_slice')
                    }}
                  >
                    <option value="shared_slice">Shared slice — share the node</option>
                    <option value="dedicated_slice">Dedicated slice — reserved capacity</option>
                    <option value="dedicated_full">Dedicated — whole node</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="alloc-cpu" className="text-xs text-muted-foreground">
                    CPU millicores (1000 = 1 vCPU)
                  </Label>
                  <Input
                    id="alloc-cpu"
                    type="number"
                    min={0}
                    value={allocationCpuMillicores}
                    onChange={(event) => {
                      setAllocationCpuMillicores(Number(event.target.value) || 0)
                    }}
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="alloc-mem" className="text-xs text-muted-foreground">
                    Memory (MB)
                  </Label>
                  <Input
                    id="alloc-mem"
                    type="number"
                    min={0}
                    value={allocationMemoryMb}
                    onChange={(event) => {
                      setAllocationMemoryMb(Number(event.target.value) || 0)
                    }}
                  />
                </div>

                <Input
                  type="number"
                  min={0}
                  value={allocationMaxServices ?? ''}
                  onChange={(event) => {
                    const value = event.target.value.trim()
                    setAllocationMaxServices(value === '' ? null : Number(value) || 0)
                  }}
                  placeholder="Max services (optional)"
                />

                <Button
                  type="button"
                  onClick={() => {
                    void handleUpsertFleetAllocation()
                  }}
                  disabled={upsertFleetAllocation.isPending}
                >
                  {upsertFleetAllocation.isPending ? 'Saving...' : 'Save allocation'}
                </Button>
              </CardContent>
            </Card>
          </div>

          <SectionIntro
            title="Review allocations"
            description="What each server has actually promised, across every registered server. Remove one to release its capacity back to the node."
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Current Allocations</CardTitle>
            </CardHeader>
            <CardContent>
              {fleetAllocationsLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : fleetAllocations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No allocations yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Server</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>CPU</TableHead>
                      <TableHead>RAM</TableHead>
                      <TableHead>Max Services</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fleetAllocations.map((allocation) => (
                      <TableRow key={allocation.id}>
                        <TableCell className="font-mono text-xs">{allocation.serverUrl ?? allocation.serverNodeId}</TableCell>
                        <TableCell>{allocation.allocationMode}</TableCell>
                        <TableCell>{allocation.cpuMillicores}m</TableCell>
                        <TableCell>{allocation.memoryMb}MB</TableCell>
                        <TableCell>{allocation.maxServices ?? '—'}</TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              void handleDeleteFleetAllocation(allocation.serverNodeId)
                            }}
                            disabled={deleteFleetAllocation.isPending}
                          >
                            Remove
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <SectionIntro
            title="Approve new servers"
            description="Requests from nodes asking to join this cluster's capacity pool. Approving one grants it an allocation."
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pending Admission Requests</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/*
                These four controls drive one decision — approve, reject, or hold
                a request — but described themselves only through placeholders, so
                their meaning vanished the moment anything was typed. The status
                filter also announced itself to a screen reader as "pending", its
                current value rather than its purpose.
              */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="admission-status" className="text-xs text-muted-foreground">
                    Show requests
                  </Label>
                  <select id="admission-status"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={admissionRequestStatusFilter}
                    onChange={(event) => {
                      setAdmissionRequestStatusFilter(event.target.value as 'pending' | 'approved' | 'rejected' | 'cancelled')
                    }}
                  >
                    <option value="pending">Awaiting a decision</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="admission-node" className="text-xs text-muted-foreground">
                    Decision server node id (optional)
                  </Label>
                  <Input
                    id="admission-node"
                    className="h-10 font-mono text-xs"
                    value={decisionServerNodeId}
                    onChange={(event) => {
                      setDecisionServerNodeId(event.target.value)
                    }}
                  />
                </div>

                <div className="space-y-1 md:col-span-2">
                  <Label htmlFor="admission-note" className="text-xs text-muted-foreground">
                    Reviewer note (optional)
                  </Label>
                  <Input
                    id="admission-note"
                    className="h-10"
                    value={reviewerNote}
                    onChange={(event) => {
                      setReviewerNote(event.target.value)
                    }}
                  />
                </div>
              </div>

              {fleetAdmissionRequestsLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : fleetAdmissionRequests.length === 0 ? (
                /*
                  The empty state used to be one grey sentence. Which sentence is
                  needed depends on WHY it is empty, and those are different
                  answers: nothing is waiting (good, stop looking at this card), or
                  this filter has no matches (change the filter).
                */
                admissionRequestStatusFilter === 'pending' ? (
                  <div className="flex flex-col items-center gap-1.5 py-8 text-center">
                    <CheckCircle2 className="h-8 w-8 text-status-live/60" />
                    <p className="text-sm font-medium">Nothing awaiting approval</p>
                    <p className="text-xs text-muted-foreground">
                      New admission requests appear here for review.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 py-8 text-center">
                    <p className="text-sm text-muted-foreground">
                      No {admissionRequestStatusFilter} requests.
                    </p>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={() => { setAdmissionRequestStatusFilter('pending') }}
                    >
                      Show requests awaiting a decision
                    </Button>
                  </div>
                )
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Requested</TableHead>
                      <TableHead>Server Scope</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fleetAdmissionRequests.map((request) => (
                      <TableRow key={request.id}>
                        <TableCell>
                          {request.requestedCpuMillicores}m · {request.requestedMemoryMb}MB · {request.requestedServices} svc
                        </TableCell>
                        <TableCell className="font-mono text-xs">{request.requestedServerNodeId ?? 'any'}</TableCell>
                        <TableCell>
                          <Badge variant={request.status === 'pending' ? 'default' : request.status === 'approved' ? 'secondary' : 'destructive'}>
                            {request.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatDateTime(request.createdAt)}</TableCell>
                        <TableCell className="space-x-2">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                              void handleResolveAdmissionRequest(request.id, 'approved')
                            }}
                            disabled={resolveFleetAdmissionRequest.isPending}
                          >
                            Approve
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              void handleResolveAdmissionRequest(request.id, 'rejected')
                            }}
                            disabled={resolveFleetAdmissionRequest.isPending}
                          >
                            Reject
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mesh" className="space-y-4">
          <SectionIntro
            title="Mesh control plane"
            description="Link instances and inspect how traffic is routed between them. Stream state is shown above."
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Local node</p>
              {isMeshStateLoading ? (
                <Skeleton className="h-6 w-full" />
              ) : (
                <p className="text-sm font-mono break-all">{localNode?.nodeId ?? 'n/a'}</p>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Membership version</p>
              {isMeshStateLoading ? (
                <Skeleton className="h-6 w-20" />
              ) : (
                <p className="text-sm font-semibold">v{snapshotData?.version ?? 0}</p>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Known nodes / edges / sessions</p>
              {isMeshStateLoading ? (
                <Skeleton className="h-6 w-full" />
              ) : (
                <p className="text-sm font-semibold">
                  {snapshotData?.nodes.length ?? 0} / {snapshotData?.connections.length ?? 0} / {snapshotData?.sessions.length ?? 0}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input
              placeholder="server URL (e.g. http://server-b:3000)"
              value={serverUrl}
              onChange={(event) => {
                setServerUrl(event.target.value)
              }}
            />
            <Button
              type="button"
              className="gap-2"
              onClick={() => {
                void handleConnectPeer()
              }}
              disabled={connectPeer.isPending || handshakeInProgress}
            >
              <PlugZap className="h-4 w-4" />
              {connectPeer.isPending || handshakeInProgress ? 'Starting handshake...' : 'Connect peer'}
            </Button>
            <div className="text-xs text-muted-foreground self-center">
              HTTP-first connect: detect server, redirect to remote login, then complete authenticated mesh handoff.
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Active connections</CardTitle>
              </CardHeader>
              <CardContent>
                {isMeshStateLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : peers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No peer connections yet.</p>
                ) : (
                  <div className="space-y-2">
                    {peers.map((peer) => (
                      <div key={peer.connectionId} className="rounded border p-3 space-y-1">
                        <p className="text-xs text-muted-foreground font-mono break-all">{peer.connectionId}</p>
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold">{peer.sourceNodeId.slice(0, 8)} → {peer.targetNodeId.slice(0, 8)}</p>
                          <Badge variant={peer.state === 'up' ? 'default' : peer.state === 'degraded' ? 'secondary' : 'destructive'}>
                            {peer.state}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          latency {peer.metrics.latencyMs}ms · jitter {peer.metrics.jitterMs}ms · loss {(peer.metrics.packetLossRatio * 100).toFixed(1)}% · weight {peer.metrics.weight.toFixed(4)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Topology graph</CardTitle>
                <CardDescription>
                  Live node/edge state with weighted links and lifecycle visibility.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {isMeshStateLoading ? (
                  <Skeleton className="h-56 w-full" />
                ) : graphLayout.nodes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No mesh nodes available yet.</p>
                ) : (
                  <div className="rounded border p-3 bg-muted/20">
                    <div className="h-90 w-full min-w-140">
                      <ReactFlow
                        nodes={flowNodes}
                        edges={flowEdges}
                        fitView
                        fitViewOptions={{ padding: 0.25 }}
                        nodesDraggable={false}
                        nodesConnectable={false}
                        elementsSelectable={false}
                        zoomOnDoubleClick={false}
                        /*
                          The attribution badge is shown. `proOptions={{ hideAttribution: true }}`
                          was set here, and React Flow only permits that with a React Flow
                          Pro subscription — without one it breaches the licence, and the
                          dev server logs a warning saying exactly that on every render.
                          If this project DOES hold a Pro licence, restoring the original
                          line is correct; leaving it off is the safe default until then.
                        */
                      >
                        <MiniMap zoomable pannable />
                        <Controls showInteractive={false} />
                        <Background variant={BackgroundVariant.Dots} gap={14} size={1} />
                      </ReactFlow>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Linked instances (sessions)</CardTitle>
                <CardDescription>
                  Internal transport sessions backing instance links.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isMeshStateLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : sessions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No sessions yet.</p>
                ) : (
                  <div className="space-y-2">
                    {sessions.map((session) => (
                      <div key={session.sessionId} className="rounded border p-3 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">{(session.peerNodeId ? session.peerNodeId.slice(0, 8) : 'pending')} · {session.state}</p>
                            <p className="text-xs text-muted-foreground font-mono break-all">{session.endpointUrl}</p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-2"
                            onClick={() => {
                              void handleDisconnectPeer(session.sessionId)
                            }}
                            disabled={disconnectPeer.isPending}
                          >
                            <Unplug className="h-3.5 w-3.5" />
                            Disconnect
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground font-mono break-all">session: {session.sessionId}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Stream route planner</CardTitle>
                <CardDescription>
                  Resolve which mesh branches should carry subscriptions based on current weights and ownership.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  placeholder="stream id (uuid)"
                  value={streamIdForRoute}
                  onChange={(event) => {
                    setStreamIdForRoute(event.target.value)
                  }}
                />
                <Input
                  type="number"
                  min={1}
                  max={6}
                  value={desiredRouteBranches}
                  onChange={(event) => {
                    setDesiredRouteBranches(Number(event.target.value) || 1)
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void handlePlanStreamRoute()
                  }}
                  disabled={planStreamRoute.isPending}
                >
                  {planStreamRoute.isPending ? 'Planning...' : 'Plan subscription branches'}
                </Button>

                {planStreamRoute.data ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Selected {planStreamRoute.data.selected.length} branch(es) out of {planStreamRoute.data.candidates.length} candidates
                    </p>
                    <div className="space-y-2">
                      {planStreamRoute.data.selected.map((branch) => (
                        <div key={`${branch.ownerNodeId}:${branch.endpointPath}`} className="rounded border p-2 text-xs font-mono break-all">
                          {branch.ownerNodeId.slice(0, 8)} · {branch.protocol} · w={branch.estimatedWeight.toFixed(4)} · {branch.ownerServerUrl}{branch.endpointPath}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Resource ownership lookup</CardTitle>
                <CardDescription>
                  Resolve control-plane owner/candidate endpoints before opening direct traffic connections.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="lookup-kind" className="text-xs text-muted-foreground">
                    Resource kind
                  </Label>
                  <select id="lookup-kind"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={lookupKind}
                    onChange={(event) => {
                      setLookupKind(event.target.value as 'stream' | 'queue' | 'deployment' | 'log')
                    }}
                  >
                    <option value="stream">Stream</option>
                    <option value="queue">Queue</option>
                    <option value="deployment">Deployment</option>
                    <option value="log">Log</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="lookup-key" className="text-xs text-muted-foreground">
                    {lookupKind} key
                  </Label>
                  <Input
                    id="lookup-key"
                    className="font-mono text-xs"
                    placeholder="e.g. 7f3c1a92-…"
                    value={lookupKey}
                    onChange={(event) => {
                    setLookupKey(event.target.value)
                  }}
                />
                </div>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void handleLookupResource()
                  }}
                  disabled={lookupResource.isPending}
                >
                  {lookupResource.isPending ? 'Resolving...' : 'Resolve ownership'}
                </Button>

                {lookupResource.data ? (
                  <div className="space-y-2 rounded border p-2 text-xs">
                    <p className="text-muted-foreground">
                      {lookupResource.data.found
                        ? `Primary owner: ${lookupResource.data.primary?.ownerNodeId.slice(0, 8) ?? 'n/a'}`
                        : 'No owner found'}
                    </p>

                    {lookupResource.data.primary ? (
                      <p className="font-mono break-all">
                        {lookupResource.data.primary.ownerServerUrl}
                        {lookupResource.data.primary.endpointPath}
                      </p>
                    ) : null}

                    {lookupResource.data.candidates.length > 0 ? (
                      <p className="text-muted-foreground">
                        Candidates: {lookupResource.data.candidates.length}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent mesh decisions</CardTitle>
                <CardDescription>
                  Last route-planning and ownership-lookup outcomes for quick operator diagnostics.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Route plans</p>
                  {routePlanHistory.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No route plan runs yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {routePlanHistory.map((entry, index) => (
                        <div key={`${entry.streamId}-${entry.at}-${String(index)}`} className="rounded border p-2 text-xs">
                          <p className="font-mono break-all">{entry.streamId}</p>
                          <p className="text-muted-foreground">
                            {formatTime(entry.at)} · selected {entry.selected}/{entry.candidates}
                            {entry.topOwner ? ` · owner ${entry.topOwner.slice(0, 8)}` : ''}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ownership lookups</p>
                  {lookupHistory.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No ownership lookups yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {lookupHistory.map((entry, index) => (
                        <div key={`${entry.kind}-${entry.key}-${entry.at}-${String(index)}`} className="rounded border p-2 text-xs">
                          <p className="font-mono break-all">{entry.kind}:{entry.key}</p>
                          <p className="text-muted-foreground">
                            {formatTime(entry.at)} · {entry.found ? 'found' : 'missing'}
                            {entry.owner ? ` · owner ${entry.owner.slice(0, 8)}` : ''}
                            {` · candidates ${String(entry.candidates)}`}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="directory" className="space-y-4">
          {/*
            This tab rendered the user list TWICE: a "Directory" card and a
            "Recent Users" card, the second being the first ten rows of the
            first. The redundant copy was also the worse one — it read every
            field through `as Record<string, unknown>`, which threw away the
            types the query already had, so `user.emial` would have compiled.

            One table remains. It keeps the richer columns from the second card
            and drops the type assertions, and it links to User management for
            the actions this tab never offered.
          */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold">Directory</h2>
              <p className="text-xs text-muted-foreground">
                {usersLoading
                  ? 'Loading members…'
                  : `${String(users.length)} user${users.length === 1 ? '' : 's'} in the mesh`}
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <AuthDashboardAdminUsers.Link>Manage users</AuthDashboardAdminUsers.Link>
            </Button>
          </div>

          <Card className={surfaceCardClass}>
            <CardContent className="pt-6">
              {usersLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : users.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {user.image ? (
                              <Image
                                src={user.image}
                                alt=""
                                width={24}
                                height={24}
                                className="h-6 w-6 rounded-full"
                              />
                            ) : (
                              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs">
                                {user.name[0]?.toUpperCase() ?? '?'}
                              </div>
                            )}
                            {user.name}
                          </div>
                        </TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>
                          <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                            {user.role}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {/* Semantic status tokens, not literal green — the
                              palette owns what "active" looks like. */}
                          <Badge
                            variant="outline"
                            className={
                              user.banned
                                ? 'border-status-danger/40 text-status-danger'
                                : 'border-status-live/40 text-status-live'
                            }
                          >
                            {user.banned ? 'Banned' : 'Active'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs tabular-nums text-muted-foreground">
                          {formatDate(user.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No users yet.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

          {/* ══════════════════════════════════════════════════════════════════
             NODE CONFIG TAB
          ══════════════════════════════════════════════════════════════════ */}
          <TabsContent value="node-config" className="space-y-4">
            {/*
              Six cards used to run down this tab as one flat list — identity,
              networking, trust material, credentials and a connectivity probe,
              all at the same visual weight and in no stated order. The other
              tabs already open with a SectionIntro; this one now does too, and
              splits the six by what an operator is actually doing at the time.
            */}
            <SectionIntro
              title="This node"
              description="Identity, network binding and persisted strategy for the node running this API. Changes take effect on the next service restart."
            />
            <NodeNetworkConfig />
            {/* Node Configuration Editor */}
            <Card className={surfaceCardClass}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Settings className="h-5 w-5 text-primary" />
                      Node Configuration
                    </CardTitle>
                    <CardDescription>
                      View and edit persisted node configuration. Changes take effect on next service restart.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {localNode && (
                      <Badge variant={localNode.lifecycleState === 'healthy' ? 'default' : localNode.lifecycleState === 'suspect' ? 'secondary' : 'destructive'}>
                        {localNode.lifecycleState}
                      </Badge>
                    )}
                    <Button variant="outline" size="sm" className="gap-1"
                      onClick={() => {
                        if (!showConfigForm) {
                          const cfg = nodeConfig ?? nodeStatus
                          setEditNodeId(cfg?.nodeId ?? localNode?.nodeId ?? '')
                          setEditStrategy(cfg?.strategy === 'remote' ? 'remote' : 'local')
                          setEditMeshUrls((cfg?.meshUrlsSnapshot ?? []).join('\n'))
                          setEditDatabaseUrl(cfg && 'databaseUrl' in cfg ? (cfg as { databaseUrl?: string }).databaseUrl ?? '' : '')
                          setEditRegion(localNode?.region ?? '')
                          setEditZone(localNode?.zone ?? '')
                          setEditVersion(localNode?.version ?? '')
                          setEditRoles((localNode?.roles ?? []).join(', '))
                          setEditRoutingMode(localNode?.routingMode ?? '')
                          setEditConsistencyMode(localNode?.consistencyMode ?? '')
                        }
                        setShowConfigForm(!showConfigForm)
                      }}>
                      <Sliders className="h-3.5 w-3.5" />
                      {showConfigForm ? 'Cancel' : 'Edit config'}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {showConfigForm ? (
                  <div className="space-y-4">
                    {/*
                      Every field here had a visible name rendered as a plain
                      `<p>`. A sighted user reads "Node ID" above the box; a
                      screen-reader user heard "edit text, UUID" and nothing
                      else, because a `<p>` is not a label and was never
                      associated with the input. Each name is now a
                      `<Label htmlFor>` pointing at the field's id.
                    */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <Label htmlFor="node-config-id" className="text-xs text-muted-foreground">
                          Node ID
                        </Label>
                        <Input id="node-config-id" value={editNodeId} onChange={(e) => { setEditNodeId(e.target.value) }} placeholder="UUID" className="font-mono text-xs" />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="node-config-strategy" className="text-xs text-muted-foreground">
                          Strategy
                        </Label>
                        <select id="node-config-strategy"
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors"
                          value={editStrategy}
                          onChange={(e) => { setEditStrategy(e.target.value as 'local' | 'remote') }}
                        >
                          <option value="local">local</option>
                          <option value="remote">remote</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="node-config-region" className="text-xs text-muted-foreground">
                          Region
                        </Label>
                        <Input id="node-config-region" value={editRegion} onChange={(e) => { setEditRegion(e.target.value) }} placeholder="e.g. eu-west-1" className="text-xs" />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="node-config-zone" className="text-xs text-muted-foreground">
                          Zone
                        </Label>
                        <Input id="node-config-zone" value={editZone} onChange={(e) => { setEditZone(e.target.value) }} placeholder="e.g. eu-west-1a" className="text-xs" />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="node-config-version" className="text-xs text-muted-foreground">
                          Version
                        </Label>
                        <Input id="node-config-version" value={editVersion} onChange={(e) => { setEditVersion(e.target.value) }} placeholder="e.g. 1.0.0" className="text-xs" />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="node-config-routing" className="text-xs text-muted-foreground">
                          Routing Mode
                        </Label>
                        <select id="node-config-routing"
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors"
                          value={editRoutingMode}
                          onChange={(e) => { setEditRoutingMode(e.target.value) }}
                        >
                          <option value="">Default</option>
                          <option value="latency">latency</option>
                          <option value="balanced">balanced</option>
                          <option value="throughput">throughput</option>
                          <option value="resilience">resilience</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="node-config-consistency" className="text-xs text-muted-foreground">
                          Consistency Mode
                        </Label>
                        <select id="node-config-consistency"
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors"
                          value={editConsistencyMode}
                          onChange={(e) => { setEditConsistencyMode(e.target.value) }}
                        >
                          <option value="">Default</option>
                          <option value="ap">AP (eventual)</option>
                          <option value="cp">CP (strong)</option>
                          <option value="hybrid">hybrid</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="node-config-roles" className="text-xs text-muted-foreground">
                          Roles (comma-separated)
                        </Label>
                        <Input id="node-config-roles" value={editRoles} onChange={(e) => { setEditRoles(e.target.value) }} placeholder="edge, relay" className="text-xs" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="node-config-db-url" className="text-xs text-muted-foreground">
                        Database URL
                      </Label>
                      <Input id="node-config-db-url" value={editDatabaseUrl} onChange={(e) => { setEditDatabaseUrl(e.target.value) }} placeholder="postgresql://..." className="font-mono text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="node-config-mesh-urls" className="text-xs text-muted-foreground">
                        Mesh URLs (one per line)
                      </Label>
                      <Textarea
                        id="node-config-mesh-urls"
                        className="min-h-15 font-mono text-xs"
                        value={editMeshUrls}
                        onChange={(e) => { setEditMeshUrls(e.target.value) }}
                        placeholder={'https://mesh-1:3001\nhttps://mesh-2:3001'}
                        rows={3}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => void handleSaveNodeConfig()} disabled={updateNodeConfig.isPending}>
                        {updateNodeConfig.isPending ? 'Saving...' : 'Save configuration'}
                      </Button>
                    </div>
                  </div>
                ) : nodeConfigLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div className="rounded-lg border bg-card p-3 space-y-1">
                      <p className="text-xs text-muted-foreground">Node ID</p>
                      <p className="text-sm font-mono break-all">{nodeConfig?.nodeId ?? nodeStatus?.nodeId ?? localNode?.nodeId ?? '—'}</p>
                    </div>
                    <div className="rounded-lg border bg-card p-3 space-y-1">
                      <p className="text-xs text-muted-foreground">Strategy</p>
                      <Badge variant="outline">{nodeConfig?.strategy ?? nodeStatus?.strategy ?? (nodeStatus?.meshUrlsSnapshot?.length ? 'remote' : 'local')}</Badge>
                    </div>
                    <div className="rounded-lg border bg-card p-3 space-y-1">
                      <p className="text-xs text-muted-foreground">Configured At</p>
                      <p className="text-sm">{formatDateTime(nodeConfig?.configuredAt ?? nodeStatus?.configuredAt?.toString())}</p>
                    </div>
                    <div className="rounded-lg border bg-card p-3 space-y-1">
                      <p className="text-xs text-muted-foreground">Region</p>
                      <p className="text-sm">{nodeConfig?.region ?? localNode?.region ?? '—'}</p>
                    </div>
                    <div className="rounded-lg border bg-card p-3 space-y-1">
                      <p className="text-xs text-muted-foreground">Zone</p>
                      <p className="text-sm">{nodeConfig?.zone ?? localNode?.zone ?? '—'}</p>
                    </div>
                    <div className="rounded-lg border bg-card p-3 space-y-1">
                      <p className="text-xs text-muted-foreground">Version</p>
                      <p className="text-sm">{nodeConfig?.version ?? localNode?.version ?? '—'}</p>
                    </div>
                    <div className="rounded-lg border bg-card p-3 space-y-1">
                      <p className="text-xs text-muted-foreground">Routing Mode</p>
                      <p className="text-sm"><Badge variant="outline">{nodeConfig?.routingMode ?? localNode?.routingMode ?? '—'}</Badge></p>
                    </div>
                    <div className="rounded-lg border bg-card p-3 space-y-1">
                      <p className="text-xs text-muted-foreground">Consistency Mode</p>
                      <p className="text-sm"><Badge variant="outline">{nodeConfig?.consistencyMode ?? localNode?.consistencyMode ?? '—'}</Badge></p>
                    </div>
                    <div className="rounded-lg border bg-card p-3 space-y-1">
                      <p className="text-xs text-muted-foreground">Roles</p>
                      <div className="flex flex-wrap gap-1">
                        {(nodeConfig?.roles ?? localNode?.roles)?.length ? (nodeConfig?.roles ?? localNode?.roles)!.map((role) => (
                          <Badge key={role} variant="secondary" className="text-[10px]">{role}</Badge>
                        )) : <span className="text-sm text-muted-foreground">—</span>}
                      </div>
                    </div>
                    <div className="rounded-lg border bg-card p-3 space-y-1">
                      <p className="text-xs text-muted-foreground">Config Status</p>
                      <p className="text-sm">
                        {nodeStatusLoading ? <Skeleton className="h-5 w-20" /> : (
                          <Badge variant={nodeStatus?.isConfigured ? 'default' : 'destructive'}>
                            {nodeStatus?.isConfigured ? 'Configured' : 'Not Configured'}
                          </Badge>
                        )}
                      </p>
                    </div>
                    <div className="rounded-lg border bg-card p-3 space-y-1">
                      <p className="text-xs text-muted-foreground">Database URL</p>
                      <p className="text-sm font-mono truncate" title={nodeConfig?.databaseUrl ?? ''}>{nodeConfig?.databaseUrl ?? '—'}</p>
                    </div>
                    <div className="rounded-lg border bg-card p-3 space-y-1">
                      <p className="text-xs text-muted-foreground">Mesh Shared Secret</p>
                      <p className="text-sm">
                        {nodeConfig?.meshSharedSecretUpdatedAt ? (
                          <Badge variant="outline" className="text-green-600">Set ({formatDateTime(nodeConfig.meshSharedSecretUpdatedAt)})</Badge>
                        ) : (
                          <Badge variant="secondary">Not set</Badge>
                        )}
                      </p>
                    </div>
                  </div>
                )}
                {!showConfigForm && nodeConfig?.meshUrlsSnapshot && nodeConfig.meshUrlsSnapshot.length > 0 && (
                  <div className="mt-4 rounded-lg border bg-card p-3 space-y-1">
                    <p className="text-xs text-muted-foreground">Mesh URLs Snapshot</p>
                    <div className="space-y-1 mt-1">
                      {nodeConfig.meshUrlsSnapshot.map((url, i) => (
                        <p key={i} className="text-xs font-mono truncate">{url}</p>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Trust Keyring */}
            <Card className={surfaceCardClass}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Key className="h-5 w-5 text-primary" />
                      Trust Keyring
                    </CardTitle>
                    <CardDescription>
                      Manage mesh trust keys for peer authentication and message signing
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="gap-1"
                      onClick={() => setShowSecrets(!showSecrets)}
                      disabled={trustSecretsLoading}>
                      <Shield className="h-3.5 w-3.5" />
                      {showSecrets ? 'Hide secrets' : 'Show secrets'}
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1"
                      onClick={() => setShowRotateForm(!showRotateForm)}>
                      <RefreshCw className="h-3.5 w-3.5" />
                      Rotate key
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded-lg border bg-card p-3 space-y-1">
                    <p className="text-xs text-muted-foreground">Active Key</p>
                    {trustKeyringLoading ? <Skeleton className="h-5 w-24" /> : (
                      <p className="text-sm font-mono">{trustKeyring?.activeKeyId ?? 'No active key'}</p>
                    )}
                  </div>
                  <div className="rounded-lg border bg-card p-3 space-y-1">
                    <p className="text-xs text-muted-foreground">Total Keys</p>
                    <p className="text-sm font-semibold">{trustKeyring?.keys.length ?? 0}</p>
                  </div>
                  <div className="rounded-lg border bg-card p-3 space-y-1">
                    <p className="text-xs text-muted-foreground">Convergence</p>
                    {keyringConvergenceLoading ? <Skeleton className="h-5 w-24" /> : (
                      <div className="flex items-center gap-2">
                        {keyringConvergence?.converged ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-amber-500" />
                        )}
                        <span className="text-sm">
                          {keyringConvergence?.converged ? 'Converged' : 'Pending'}
                          {keyringConvergence ? ` (${keyringConvergence.receivedAcks}/${keyringConvergence.expectedAcks})` : ''}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {showRotateForm && (
                  <div className="rounded-lg border bg-card p-4 space-y-3">
                    <p className="text-sm font-semibold">Rotate Trust Key</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Key ID (optional)</p>
                        <Input value={rotateKeyId} onChange={(e) => setRotateKeyId(e.target.value)} placeholder="Auto-generate" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Secret Material (optional)</p>
                        <Input value={rotateSecret} onChange={(e) => setRotateSecret(e.target.value)} placeholder="Auto-generate" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => void handleRotateKey()} disabled={rotateKey.isPending}>
                        {rotateKey.isPending ? 'Rotating...' : 'Confirm rotation'}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => { setShowRotateForm(false); setRotateKeyId(''); setRotateSecret('') }}>Cancel</Button>
                    </div>
                  </div>
                )}

                {trustKeyring && trustKeyring.keys.length > 0 && (
                  <div className="rounded-lg border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Key ID</TableHead>
                          <TableHead>Algorithm</TableHead>
                          <TableHead>Status</TableHead>
                          {showSecrets && <TableHead>Secret Material</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(showSecrets ? (trustSecrets?.keys ?? []) : trustKeyring.keys).map((key) => (
                          <TableRow key={key.keyId}>
                            <TableCell className="font-mono text-xs">{key.keyId}</TableCell>
                            <TableCell><Badge variant="outline">{key.algorithm}</Badge></TableCell>
                            <TableCell>
                              <Badge variant={key.status === 'active' ? 'default' : 'secondary'}>
                                {key.status}
                              </Badge>
                            </TableCell>
                            {showSecrets && (
                              <TableCell className="font-mono text-xs max-w-48 truncate">
                                {'secretMaterial' in key ? (key as { secretMaterial?: string }).secretMaterial ?? '—' : '—'}
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {keyringConvergence && !keyringConvergence.converged && (
                  <div className="rounded-lg border bg-amber-50 dark:bg-amber-950/20 p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <AlertCircle className="h-4 w-4 text-amber-500" />
                      <span className="font-medium">Convergence pending</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {keyringConvergence.receivedAcks}/{keyringConvergence.expectedAcks} acknowledgements received.
                      {keyringConvergence.pendingNodeIds.length > 0 && (
                        <> Pending nodes: {keyringConvergence.pendingNodeIds.map((id) => shortId(id)).join(', ')}</>
                      )}
                    </p>
                    {keyringConvergence.lastRotatedAt && (
                      <p className="text-xs text-muted-foreground mt-1">Last rotation: {formatDateTime(keyringConvergence.lastRotatedAt)}</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <SectionIntro
              title="Trust and credentials"
              description="How peers prove they belong to this mesh, and the shared secret they present. Rotating either one requires every peer to re-enroll."
            />

            {/* Strict Mode */}
            <Card className={surfaceCardClass}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <ShieldAlert className="h-5 w-5 text-primary" />
                      Strict Mode
                    </CardTitle>
                    <CardDescription>
                      Enforce trust keyring convergence across the mesh. When enabled, all nodes must acknowledge the
                      latest key before it becomes active.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-3">
                    {strictReadiness?.rollbackRecommended && (
                      <Badge variant="destructive" className="gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Rollback recommended
                      </Badge>
                    )}
                    <div className="flex items-center gap-2">
                      {/* `Switch` renders a <button> (Radix Root), so a
                          <label htmlFor> would not associate. Name it via
                          aria-labelledby instead — previously this control had
                          no accessible name at all. */}
                      <span id="mesh-strict-mode-label" className="text-xs text-muted-foreground">
                        Strict mode
                      </span>
                      <Switch
                        aria-labelledby="mesh-strict-mode-label"
                        checked={strictEnabled}
                        onCheckedChange={(checked) => void handleToggleStrictMode(checked)}
                        disabled={setStrictMode.isPending}
                      />
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {strictReadinessLoading ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10" />)}
                  </div>
                ) : strictReadiness ? (
                  <>
                    <StatStrip bare>
                      <StatStripItem
                        icon={strictReadiness.ready ? CheckCircle2 : XCircle}
                        label="Ready"
                        value={strictReadiness.ready ? 'Ready' : 'Not ready'}
                        tone={strictReadiness.ready ? 'live' : 'danger'}
                      />
                      <StatStripItem
                        icon={strictReadiness.converged ? CheckCircle2 : AlertCircle}
                        label="Convergence"
                        value={`${Math.round(strictReadiness.ackRatio * 100)}%`}
                        hint={`${strictReadiness.receivedAcks}/${strictReadiness.expectedAcks} nodes · min ${strictReadiness.minAckRatio * 100}%`}
                        tone={strictReadiness.converged ? 'live' : 'pending'}
                      />
                      <StatStripItem
                        label="Max ack age"
                        value={`${strictReadiness.maxAckAgeSeconds}s`}
                      />
                      <StatStripItem
                        label="Active key age"
                        value={
                          strictReadiness.lastRotationAgeSeconds != null
                            ? `${Math.round(strictReadiness.lastRotationAgeSeconds / 60)}m`
                            : '—'
                        }
                      />
                    </StatStrip>

                    {strictReadiness.reasons.length > 0 && (
                      <div className="rounded-lg border bg-card p-3 space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground">Readiness Reasons</p>
                        <ul className="space-y-1">
                          {strictReadiness.reasons.map((reason, i) => (
                            <li key={i} className="text-xs flex items-start gap-2">
                              <span className="mt-0.5">{strictReadiness.ready ? '✓' : '✗'}</span>
                              <span>{reason}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {strictReadiness.rollbackTriggers.length > 0 && (
                      <div className="rounded-lg border bg-red-50 dark:bg-red-950/20 p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <ShieldAlert className="h-4 w-4 text-red-500" />
                          <p className="text-sm font-semibold text-red-700 dark:text-red-400">Rollback Triggers</p>
                        </div>
                        <ul className="space-y-1">
                          {strictReadiness.rollbackTriggers.map((trigger, i) => (
                            <li key={i} className="text-xs text-red-600 dark:text-red-400">{trigger}</li>
                          ))}
                        </ul>
                        {strictReadiness.rollbackRecommended && (
                          <Button variant="destructive" size="sm" className="mt-2"
                            onClick={() => void handleRollbackStrict()}
                            disabled={rollbackStrict.isPending}>
                            {rollbackStrict.isPending ? 'Rolling back...' : 'Rollback strict mode'}
                          </Button>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-2 py-8 text-center">
                    <Shield className="h-10 w-10 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">Strict mode data not available</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Mesh Shared Secret */}
            <Card className={surfaceCardClass}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Key className="h-5 w-5 text-primary" />
                  Mesh Shared Secret
                </CardTitle>
                <CardDescription>
                  The shared secret is used by `requireMesh()` to verify peer credentials. Rotating it will invalidate
                  all existing peer service tokens — peers must re-enroll.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border bg-card p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">Current Status</p>
                      <p className="text-sm">
                        {nodeConfig?.meshSharedSecretUpdatedAt ? (
                          <Badge variant="default" className="mt-1">
                            <Shield className="h-3 w-3 mr-1" />
                            Secret set
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="mt-1">No secret configured</Badge>
                        )}
                      </p>
                    </div>
                    <Button variant="destructive" size="sm" className="gap-1"
                      onClick={() => void handleRegenerateSecret()}
                      disabled={regenerateSecret.isPending}>
                      <RefreshCw className="h-3.5 w-3.5" />
                      {regenerateSecret.isPending ? 'Regenerating...' : 'Regenerate secret'}
                    </Button>
                  </div>
                  {nodeConfig?.meshSharedSecretUpdatedAt && (
                    <p className="text-xs text-muted-foreground">
                      Last rotated: {formatDateTime(nodeConfig.meshSharedSecretUpdatedAt)}
                    </p>
                  )}
                </div>

                {showSecretResult && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">New Secret Generated</p>
                        <p className="text-xs text-amber-600 dark:text-amber-500">
                          Copy this secret now. You will not be able to see it again.
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" className="h-6 text-xs"
                        onClick={() => {
                          navigator.clipboard.writeText(showSecretResult)
                          toast.success('Secret copied to clipboard')
                        }}>
                        Copy
                      </Button>
                    </div>
                    <div className="rounded bg-amber-100 dark:bg-amber-900/30 p-2">
                      <code className="text-xs font-mono break-all select-all">{showSecretResult}</code>
                    </div>
                    <Button variant="outline" size="sm" className="text-xs"
                      onClick={() => setShowSecretResult(null)}>
                      Dismiss
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <SectionIntro
              title="Connectivity and cluster state"
              description="Verify a database before committing it to the node config, and read the mesh membership snapshot."
            />

            {/* Database Connection Test */}
            <Card className={surfaceCardClass}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server className="h-5 w-5 text-primary" />
                  Database Connection Test
                </CardTitle>
                <CardDescription>
                  Test connectivity to a PostgreSQL database URL before saving it to the node config.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    className="font-mono text-xs flex-1"
                    value={testDbUrl}
                    onChange={(e) => setTestDbUrl(e.target.value)}
                    placeholder="postgresql://user:pass@host:5432/db"
                  />
                  <Button size="sm" onClick={() => void handleTestDbConnection()} disabled={testDb.isPending || !testDbUrl.trim()}>
                    {testDb.isPending ? 'Testing...' : 'Test'}
                  </Button>
                </div>

                {testDbResult && (
                  <div className={`rounded-lg border p-3 space-y-1 ${
                    testDbResult.connected
                      ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20'
                      : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20'
                  }`}>
                    <div className="flex items-center gap-2">
                      {testDbResult.connected ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                      <p className={`text-sm font-semibold ${testDbResult.connected ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                        {testDbResult.connected ? 'Connection successful' : 'Connection failed'}
                      </p>
                    </div>
                    {testDbResult.isNewDatabase !== null && testDbResult.isNewDatabase !== undefined && (
                      <p className="text-xs text-muted-foreground ml-6">
                        {testDbResult.isNewDatabase ? 'Fresh database (no existing data)' : 'Existing database with data'}
                      </p>
                    )}
                    {testDbResult.error && (
                      <p className="text-xs text-red-600 dark:text-red-400 ml-6 font-mono">{testDbResult.error}</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Mesh Overview Stats */}
            <Card className={surfaceCardClass}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="h-5 w-5 text-primary" />
                  Cluster Overview
                </CardTitle>
                <CardDescription>
                  Current cluster state from the mesh membership snapshot
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/*
                  Three bordered tiles inside a bordered Card, each inflating a
                  small integer to 2xl. The inner borders existed only to
                  separate the three from each other, which the Card — and now
                  the row's own spacing — already does.

                  `?? 0` is gone too: while the snapshot is loading, "we do not
                  know yet" was being reported as the confident value zero.
                */}
                <StatStrip bare>
                  <StatStripItem
                    label="Membership version"
                    value={snapshotData?.version}
                    hint="moves on every topology change"
                  />
                  <StatStripItem
                    label="Peers"
                    value={peers.length}
                    hint={`${String(peers.filter((p) => p.state === 'up').length)} up · ${String(peers.filter((p) => p.state === 'degraded').length)} degraded`}
                  />
                  <StatStripItem
                    label="Trust keys"
                    value={trustKeyring?.keys.length}
                    hint={
                      trustKeyring?.activeKeyId
                        ? `active ${shortId(trustKeyring.activeKeyId)}`
                        : 'no active key'
                    }
                  />
                </StatStrip>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
  )
}
