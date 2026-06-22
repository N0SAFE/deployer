'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useOrganizations, useAllOrganizationPendingInvitations } from '@/domains/organization/hooks'
import { useUserList } from '@/domains/user/hooks'
import { useNodeStatus } from '@/domains/setup/hooks'
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
import { Separator } from '@repo/ui/components/shadcn/separator'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { Progress } from '@repo/ui/components/shadcn/progress'
import { Label } from '@repo/ui/components/shadcn/label'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@repo/ui/components/shadcn/tooltip'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import {
  AlertCircle,
  ArrowUpDown,
  Building2,
  CheckCircle2,
  Globe,
  Key,
  Mail,
  Network,
  PlugZap,
  RefreshCw,
  Scan,
  Server,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Unplug,
  Users,
  XCircle,
} from 'lucide-react'
import Image from 'next/image'
import { AuthDashboardAdminOrganizationsOrganizationId } from '@/routes'
import { toast } from 'sonner'

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
  const { data: organizations, isLoading: orgsLoading } = useOrganizations()
  const { data: pendingInvitations, isLoading: invitesLoading } = useAllOrganizationPendingInvitations()
  
  // Use domain-based user hooks
  const { data: usersData, isLoading: usersLoading } = useUserList({
    query: {
      limit: 100,
      offset: 0,
    },
  })
  
  // Note: userQueryKeys can be used for manual cache operations:
  // queryClient.invalidateQueries({ queryKey: userQueryKeys.list() })
  // queryClient.prefetchQuery({ queryKey: userQueryKeys.list({ limit: 100 }), ... })

  const users = usersData?.data ?? []
  const { data: fleetServersData, isLoading: fleetServersLoading } = useFleetServers()
  const { data: fleetAllocationsData, isLoading: fleetAllocationsLoading } = useFleetAllocations()
  const [admissionRequestStatusFilter, setAdmissionRequestStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'cancelled'>('pending')
  const [admissionRequestOrgFilter, setAdmissionRequestOrgFilter] = useState('')
  const [reviewerNote, setReviewerNote] = useState('')
  const [decisionServerNodeId, setDecisionServerNodeId] = useState('')
  const { data: fleetAdmissionRequestsData, isLoading: fleetAdmissionRequestsLoading } = useFleetAdmissionRequests({
    status: admissionRequestStatusFilter,
    organizationId: admissionRequestOrgFilter.trim() === '' ? undefined : admissionRequestOrgFilter.trim(),
  })
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
  const { data: strictReadiness, isLoading: strictReadinessLoading } = useMeshTrustStrictReadiness()
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
  const [allocationOrganizationId, setAllocationOrganizationId] = useState('')
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
  const localNode = meshState?.localNode
  const snapshotData = meshState?.snapshot
  const meshEventStreams = meshEventStreamsData?.data ?? []
  const activeMeshEventStreams = meshEventStreams.filter((stream) => stream.isActive).length
  const isMeshStateLoading = meshStreamStatus === 'connecting' && !meshState
  const surfaceCardClass =
    'border-slate-200/80 bg-white/85 shadow-sm backdrop-blur supports-backdrop-filter:bg-white/70 dark:border-slate-800 dark:bg-slate-950/45'

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
    const firstOrganization = organizations?.at(0)
    if (!allocationOrganizationId && firstOrganization) {
      setAllocationOrganizationId(firstOrganization.id)
    }
  }, [allocationOrganizationId, organizations])

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
          const message = error instanceof Error ? error.message : 'Unknown mesh auth handoff error'
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
      const message = error instanceof Error ? error.message : 'Unknown mesh connect preflight error'
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
      const message = error instanceof Error ? error.message : 'Unknown mesh disconnect error'
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
      const message = error instanceof Error ? error.message : 'Unknown route planning error'
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
      const message = error instanceof Error ? error.message : 'Unknown ownership lookup error'
      toast.error(`Unable to lookup resource ownership: ${message}`)
    }
  }

  const handleUpsertFleetAllocation = async () => {
    if (!allocationOrganizationId) {
      toast.error('Select an organization first')
      return
    }

    if (!allocationServerNodeId) {
      toast.error('Select a server first')
      return
    }

    try {
      await upsertFleetAllocation.mutateAsync({
        organizationId: allocationOrganizationId,
        serverNodeId: allocationServerNodeId,
        allocationMode,
        cpuMillicores: Math.max(0, allocationCpuMillicores),
        memoryMb: Math.max(0, allocationMemoryMb),
        maxServices: allocationMaxServices,
        isEnabled: true,
      })

      toast.success('Organization/server capacity allocation saved')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown allocation error'
      toast.error(`Failed to save allocation: ${message}`)
    }
  }

  const handleDeleteFleetAllocation = async (organizationId: string, serverNodeId: string) => {
    try {
      await deleteFleetAllocation.mutateAsync({ organizationId, serverNodeId })
      toast.success('Allocation removed')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown deletion error'
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
      const message = error instanceof Error ? error.message : 'Unknown request resolution error'
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
      const message = error instanceof Error ? error.message : 'Unknown error'
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
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast.error(`Failed to rotate key: ${message}`)
    }
  }

  const handleRollbackStrict = async () => {
    try {
      await rollbackStrict.mutateAsync({ force: false })
      toast.success('Strict mode rollback initiated')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
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
        roles: editRoles.trim() ? editRoles.split(',').map((s) => s.trim() as any) : null,
        routingMode: (editRoutingMode as any) || null,
        consistencyMode: (editConsistencyMode as any) || null,
      })
      setShowConfigForm(false)
      toast.success('Node configuration updated')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast.error(`Failed to update config: ${message}`)
    }
  }

  const handleRegenerateSecret = async () => {
    try {
      const result = await regenerateSecret.mutateAsync({})
      setShowSecretResult(result.meshSharedSecret)
      toast.success('Mesh shared secret regenerated')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
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
      const message = error instanceof Error ? error.message : 'Unknown error'
      setTestDbResult({ connected: false, error: message })
      toast.error(`Database test failed: ${message}`)
    }
  }

  const surfaceCardClass =
    'border-slate-200/80 bg-white/85 shadow-sm backdrop-blur supports-backdrop-filter:bg-white/70 dark:border-slate-800 dark:bg-slate-950/45'

  const shortId = (id: string | undefined | null, len = 8): string => {
    if (!id) return '—'
    return id.length > len ? id.slice(0, len) : id
  }

  const formatTimestamp = (iso: string | null | undefined): string => {
    if (!iso) return '—'
    try { return new Date(iso).toLocaleString() } catch { return iso }
  }

  return (
    <div className="container mx-auto max-w-360 py-6 space-y-6">
        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-slate-200/70 bg-linear-to-b from-white to-slate-50/70 p-6 shadow-sm dark:border-slate-800 dark:from-slate-950 dark:to-slate-900/50">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">System Dashboard</h1>
              <p className="mt-1 text-muted-foreground">
                Mesh topology, fleet capacity, directory, and node configuration
              </p>
            </div>
            <Badge variant={meshStreamStatus === 'connected' ? 'default' : meshStreamStatus === 'error' ? 'destructive' : 'secondary'}>
              {meshStreamStatus}
            </Badge>
          </div>
          <Separator className="my-4" />
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
              <Users className="h-3.5 w-3.5" />
              {usersLoading ? '…' : `${users.length} users`}
            </Badge>
            <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
              <Building2 className="h-3.5 w-3.5" />
              {orgsLoading ? '…' : `${organizations?.length ?? 0} orgs`}
            </Badge>
            <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
              <Mail className="h-3.5 w-3.5" />
              {invitesLoading ? '…' : `${pendingInvitations?.length ?? 0} invites`}
            </Badge>
            <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
              <Network className="h-3.5 w-3.5" />
              {isMeshStateLoading ? '…' : `${peers.length} peers`}
            </Badge>
            <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
              <Server className="h-3.5 w-3.5" />
              {isMeshStateLoading ? '…' : `${fleetServers.length} servers`}
            </Badge>
            <Badge variant="outline" className="gap-1.5 px-3 py-1.5">
              <Shield className="h-3.5 w-3.5" />
              {strictReadinessLoading ? '…' : strictReadiness?.strictConfigured ? (strictReadiness.strictEnforced ? 'Strict ON' : 'Strict OFF') : 'N/A'}
            </Badge>
            {meshStreamError && (
              <Badge variant="destructive" className="gap-1.5 px-3 py-1.5">
                <AlertCircle className="h-3.5 w-3.5" />
                {meshStreamError}
              </Badge>
            )}
          </div>
        </div>

        {/* ── Tabs ──────────────────────────────────────────────────────── */}
        <Tabs defaultValue="fleet" className="space-y-4">
          <TabsList className="inline-flex w-full md:w-auto">
            <TabsTrigger value="fleet" className="gap-2"><Server className="h-4 w-4" /> Fleet & Capacity</TabsTrigger>
            <TabsTrigger value="mesh" className="gap-2"><Network className="h-4 w-4" /> Mesh Control</TabsTrigger>
            <TabsTrigger value="directory" className="gap-2"><Building2 className="h-4 w-4" /> Directory</TabsTrigger>
            <TabsTrigger value="node-config" className="gap-2"><Settings className="h-4 w-4" /> Node Config</TabsTrigger>
          </TabsList>

        <TabsContent value="fleet" className="space-y-6">
      <Card className={surfaceCardClass}>
        <CardHeader>
          <CardTitle>Superadmin Capacity Manager (Phase 1)</CardTitle>
          <CardDescription>
            Manage which organization can use which connected server and with what CPU/RAM capacity.
            Each instance stays on its own single database.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
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
                              <p className="font-mono text-sm truncate" title={server.nodeId}>{server.nodeId}</p>
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
                                className={`h-1.5 ${
                                  cpuPct != null && cpuPct >= 90
                                    ? '*:data-[slot=progress-indicator]:bg-red-500'
                                    : cpuPct != null && cpuPct >= 70
                                      ? '*:data-[slot=progress-indicator]:bg-yellow-500'
                                      : '*:data-[slot=progress-indicator]:bg-green-500'
                                }`}
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
                                className={`h-1.5 ${
                                  memPct != null && memPct >= 90
                                    ? '*:data-[slot=progress-indicator]:bg-red-500'
                                    : memPct != null && memPct >= 70
                                      ? '*:data-[slot=progress-indicator]:bg-yellow-500'
                                      : '*:data-[slot=progress-indicator]:bg-green-500'
                                }`}
                              />
                              <p className="text-muted-foreground">{String(usedMem)}MB / {maxMem != null ? `${String(maxMem)}MB` : '∞'}</p>
                            </div>
                          </div>
                          {server.allocationSummary.organizations > 0 && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Building2 className="h-3 w-3" />
                              <span>{server.allocationSummary.organizations} organization(s)</span>
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
                              />
                              <Input
                                className="h-7 text-xs"
                                type="number"
                                min={1}
                                value={capacityEditMaxMem}
                                onChange={(e) => { setCapacityEditMaxMem(e.target.value) }}
                                placeholder="Max RAM (MB)"
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
                                      onError: (err) => { toast.error(err instanceof Error ? err.message : 'Failed to update capacity') },
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
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={allocationOrganizationId}
                  onChange={(event) => {
                    setAllocationOrganizationId(event.target.value)
                  }}
                >
                  <option value="">Select organization</option>
                  {(organizations ?? []).map((org) => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>

                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={allocationServerNodeId}
                  onChange={(event) => {
                    setAllocationServerNodeId(event.target.value)
                  }}
                >
                  <option value="">Select server</option>
                  {fleetServers.map((server) => (
                    <option key={server.nodeId} value={server.nodeId}>
                      {server.displayName ?? server.nodeId.slice(0, 8)} · {server.serverUrl}
                    </option>
                  ))}
                </select>

                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={allocationMode}
                  onChange={(event) => {
                    setAllocationMode(event.target.value as 'dedicated_full' | 'dedicated_slice' | 'shared_slice')
                  }}
                >
                  <option value="shared_slice">shared_slice</option>
                  <option value="dedicated_slice">dedicated_slice</option>
                  <option value="dedicated_full">dedicated_full</option>
                </select>

                <Input
                  type="number"
                  min={0}
                  value={allocationCpuMillicores}
                  onChange={(event) => {
                    setAllocationCpuMillicores(Number(event.target.value) || 0)
                  }}
                  placeholder="CPU millicores (1000 = 1 vCPU)"
                />

                <Input
                  type="number"
                  min={0}
                  value={allocationMemoryMb}
                  onChange={(event) => {
                    setAllocationMemoryMb(Number(event.target.value) || 0)
                  }}
                  placeholder="Memory MB"
                />

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
                      <TableHead>Organization</TableHead>
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
                        <TableCell>{allocation.organizationName ?? allocation.organizationId}</TableCell>
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
                              void handleDeleteFleetAllocation(allocation.organizationId, allocation.serverNodeId)
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

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pending Admission Requests</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={admissionRequestStatusFilter}
                  onChange={(event) => {
                    setAdmissionRequestStatusFilter(event.target.value as 'pending' | 'approved' | 'rejected' | 'cancelled')
                  }}
                >
                  <option value="pending">pending</option>
                  <option value="approved">approved</option>
                  <option value="rejected">rejected</option>
                  <option value="cancelled">cancelled</option>
                </select>

                <Input
                  value={admissionRequestOrgFilter}
                  onChange={(event) => {
                    setAdmissionRequestOrgFilter(event.target.value)
                  }}
                  placeholder="Optional organization id filter"
                />

                <Input
                  value={decisionServerNodeId}
                  onChange={(event) => {
                    setDecisionServerNodeId(event.target.value)
                  }}
                  placeholder="Decision server node id (optional)"
                />

                <Input
                  value={reviewerNote}
                  onChange={(event) => {
                    setReviewerNote(event.target.value)
                  }}
                  placeholder="Reviewer note (optional)"
                />
              </div>

              {fleetAdmissionRequestsLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : fleetAdmissionRequests.length === 0 ? (
                <p className="text-sm text-muted-foreground">No admission requests for current filters.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Organization</TableHead>
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
                        <TableCell>{request.organizationName ?? request.organizationId}</TableCell>
                        <TableCell>
                          {request.requestedCpuMillicores}m · {request.requestedMemoryMb}MB · {request.requestedServices} svc
                        </TableCell>
                        <TableCell className="font-mono text-xs">{request.requestedServerNodeId ?? 'any'}</TableCell>
                        <TableCell>
                          <Badge variant={request.status === 'pending' ? 'default' : request.status === 'approved' ? 'secondary' : 'destructive'}>
                            {request.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{new Date(request.createdAt).toLocaleString()}</TableCell>
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
        </CardContent>
      </Card>

        </TabsContent>

        <TabsContent value="mesh" className="space-y-6">

      <Card className={surfaceCardClass}>
        <CardHeader>
          <CardTitle>Mesh Control Plane (Temporary)</CardTitle>
          <CardDescription>
            Link instances directly and inspect mesh topology.
          </CardDescription>
          <CardDescription>
            Stream: <span className="font-semibold">{meshStreamStatus}</span>
            {meshStreamError ? ` · ${meshStreamError}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
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
                        proOptions={{ hideAttribution: true }}
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
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={lookupKind}
                  onChange={(event) => {
                    setLookupKind(event.target.value as 'stream' | 'queue' | 'deployment' | 'log')
                  }}
                >
                  <option value="stream">stream</option>
                  <option value="queue">queue</option>
                  <option value="deployment">deployment</option>
                  <option value="log">log</option>
                </select>

                <Input
                  placeholder="resource key (e.g. stream uuid)"
                  value={lookupKey}
                  onChange={(event) => {
                    setLookupKey(event.target.value)
                  }}
                />

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
                            {new Date(entry.at).toLocaleTimeString()} · selected {entry.selected}/{entry.candidates}
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
                            {new Date(entry.at).toLocaleTimeString()} · {entry.found ? 'found' : 'missing'}
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
        </CardContent>
      </Card>

        </TabsContent>

        <TabsContent value="directory" className="space-y-6">

      {/* Organizations Table */}
      <Card className={surfaceCardClass}>
        <CardHeader>
          <CardTitle>All Organizations</CardTitle>
          <CardDescription>
            {organizations?.length ?? 0} organization{organizations?.length !== 1 ? 's' : ''} in the system
          </CardDescription>
        </CardHeader>
        <CardContent>
          {orgsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : organizations && organizations.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Created At</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {organizations.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {org.logo ? (
                          <Image src={org.logo} alt={org.name} width={24} height={24} className="h-6 w-6 rounded" />
                        ) : (
                          <Building2 className="h-6 w-6 text-muted-foreground" />
                        )}
                        {org.name}
                      </div>
                    </TableCell>
                    <TableCell>@{org.slug}</TableCell>
                    <TableCell>{new Date(org.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <AuthDashboardAdminOrganizationsOrganizationId.Link organizationId={org.id} className="text-sm text-primary hover:underline">
                        View details
                      </AuthDashboardAdminOrganizationsOrganizationId.Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              No organizations yet
            </p>
          )}
        </CardContent>
      </Card>

      {/* Pending Invitations Table */}
      {(pendingInvitations?.length ?? 0) > 0 && (
        <Card className={surfaceCardClass}>
          <CardHeader>
            <CardTitle>Pending Invitations</CardTitle>
            <CardDescription>
              {pendingInvitations?.length ?? 0} pending invitation{(pendingInvitations?.length ?? 0) !== 1 ? 's' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvitations?.map((invitation) => (
                  <TableRow key={invitation.id}>
                    <TableCell className="font-medium">{invitation.email}</TableCell>
                    <TableCell>{invitation.organizationId}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{invitation.role}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          invitation.status === 'pending'
                            ? 'default'
                            : invitation.status === 'accepted'
                            ? 'success'
                            : 'destructive'
                        }
                      >
                        {invitation.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {new Date(invitation.expiresAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Recent Users Table */}
      <Card className={surfaceCardClass}>
        <CardHeader>
          <CardTitle>Recent Users</CardTitle>
          <CardDescription>
            Latest {Math.min(users.length, 10)} users in the system
          </CardDescription>
        </CardHeader>
        <CardContent>
          {usersLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
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
                  <TableHead>Created At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.slice(0, 10).map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {user.image ? (
                          <Image src={user.image} alt={user.name} width={24} height={24} className="h-6 w-6 rounded-full" />
                        ) : (
                          <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-xs">
                            {user.name[0]?.toUpperCase()}
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
                      <Badge
                        variant={user.banned ? 'destructive' : 'outline'}
                        className={user.banned ? '' : 'border-green-500 text-green-600'}
                      >
                        {user.banned ? 'Banned' : 'Active'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {new Date(user.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              No users found
            </p>
          )}
        </CardContent>
      </Card>

        </TabsContent>

          {/* ══════════════════════════════════════════════════════════════════
             NODE CONFIG TAB
          ══════════════════════════════════════════════════════════════════ */}
          <TabsContent value="node-config" className="space-y-6">
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
                          setEditDatabaseUrl((cfg as any)?.databaseUrl ?? '')
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
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Node ID</p>
                        <Input value={editNodeId} onChange={(e) => setEditNodeId(e.target.value)} placeholder="UUID" className="font-mono text-xs" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Strategy</p>
                        <select
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors"
                          value={editStrategy}
                          onChange={(e) => setEditStrategy(e.target.value as 'local' | 'remote')}
                        >
                          <option value="local">local</option>
                          <option value="remote">remote</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Region</p>
                        <Input value={editRegion} onChange={(e) => setEditRegion(e.target.value)} placeholder="e.g. eu-west-1" className="text-xs" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Zone</p>
                        <Input value={editZone} onChange={(e) => setEditZone(e.target.value)} placeholder="e.g. eu-west-1a" className="text-xs" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Version</p>
                        <Input value={editVersion} onChange={(e) => setEditVersion(e.target.value)} placeholder="e.g. 1.0.0" className="text-xs" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Routing Mode</p>
                        <select
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors"
                          value={editRoutingMode}
                          onChange={(e) => setEditRoutingMode(e.target.value)}
                        >
                          <option value="">Default</option>
                          <option value="latency">latency</option>
                          <option value="balanced">balanced</option>
                          <option value="throughput">throughput</option>
                          <option value="resilience">resilience</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Consistency Mode</p>
                        <select
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors"
                          value={editConsistencyMode}
                          onChange={(e) => setEditConsistencyMode(e.target.value)}
                        >
                          <option value="">Default</option>
                          <option value="ap">AP (eventual)</option>
                          <option value="cp">CP (strong)</option>
                          <option value="hybrid">hybrid</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Roles (comma-separated)</p>
                        <Input value={editRoles} onChange={(e) => setEditRoles(e.target.value)} placeholder="edge, relay" className="text-xs" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Database URL</p>
                      <Input value={editDatabaseUrl} onChange={(e) => setEditDatabaseUrl(e.target.value)} placeholder="postgresql://..." className="font-mono text-xs" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Mesh URLs (one per line)</p>
                      <textarea
                        className="flex min-h-15 w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
                        value={editMeshUrls}
                        onChange={(e) => setEditMeshUrls(e.target.value)}
                        placeholder="https://mesh-1:3001&#10;https://mesh-2:3001"
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
                      <p className="text-sm">{formatTimestamp(nodeConfig?.configuredAt ?? nodeStatus?.configuredAt?.toString())}</p>
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
                          <Badge variant="outline" className="text-green-600">Set ({formatTimestamp(nodeConfig.meshSharedSecretUpdatedAt)})</Badge>
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
                                {'secretMaterial' in key ? (key as any).secretMaterial : '—'}
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
                      <p className="text-xs text-muted-foreground mt-1">Last rotation: {formatTimestamp(keyringConvergence.lastRotatedAt)}</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

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
                      <p className="text-xs text-muted-foreground">Strict mode</p>
                      <Switch
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
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20" />)}
                  </div>
                ) : strictReadiness ? (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="rounded-lg border bg-card p-3 space-y-1">
                        <p className="text-xs text-muted-foreground">Ready</p>
                        <div className="flex items-center gap-2">
                          {strictReadiness.ready ? (
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                          ) : (
                            <XCircle className="h-5 w-5 text-red-500" />
                          )}
                          <span className="text-sm font-semibold">{strictReadiness.ready ? 'Ready' : 'Not Ready'}</span>
                        </div>
                      </div>
                      <div className="rounded-lg border bg-card p-3 space-y-1">
                        <p className="text-xs text-muted-foreground">Convergence</p>
                        <div className="flex items-center gap-2">
                          {strictReadiness.converged ? (
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                          ) : (
                            <AlertCircle className="h-5 w-5 text-amber-500" />
                          )}
                          <span className="text-sm font-semibold">{Math.round(strictReadiness.ackRatio * 100)}%</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{strictReadiness.receivedAcks}/{strictReadiness.expectedAcks} nodes</p>
                      </div>
                      <div className="rounded-lg border bg-card p-3 space-y-1">
                        <p className="text-xs text-muted-foreground">Ack Ratio</p>
                        <Progress value={strictReadiness.ackRatio * 100} className="h-2 mt-2" />
                        <p className="text-xs text-muted-foreground mt-1">
                          min {strictReadiness.minAckRatio * 100}% · max age {strictReadiness.maxAckAgeSeconds}s
                        </p>
                      </div>
                      <div className="rounded-lg border bg-card p-3 space-y-1">
                        <p className="text-xs text-muted-foreground">Active Key Age</p>
                        <p className="text-sm font-semibold">
                          {strictReadiness.lastRotationAgeSeconds != null
                            ? `${Math.round(strictReadiness.lastRotationAgeSeconds / 60)}m`
                            : '—'}
                        </p>
                      </div>
                    </div>

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
                      Last rotated: {formatTimestamp(nodeConfig.meshSharedSecretUpdatedAt)}
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
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded-lg border bg-card p-3 space-y-1">
                    <p className="text-xs text-muted-foreground">Membership Version</p>
                    <p className="text-2xl font-bold">{snapshotData?.version ?? 0}</p>
                  </div>
                  <div className="rounded-lg border bg-card p-3 space-y-1">
                    <p className="text-xs text-muted-foreground">Total Peers</p>
                    <p className="text-2xl font-bold">{peers.length}</p>
                    <p className="text-xs text-muted-foreground">{peers.filter((p) => p.state === 'up').length} up · {peers.filter((p) => p.state === 'degraded').length} degraded</p>
                  </div>
                  <div className="rounded-lg border bg-card p-3 space-y-1">
                    <p className="text-xs text-muted-foreground">Trust Keyring</p>
                    <p className="text-2xl font-bold">{trustKeyring?.keys.length ?? 0}</p>
                    <p className="text-xs text-muted-foreground">
                      {trustKeyring?.activeKeyId ? `Active: ${shortId(trustKeyring.activeKeyId)}` : 'No active key'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
  )
}
