'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useOrganizations, useAllOrganizationPendingInvitations } from '@/domains/organization/hooks'
import { useUserList } from '@/domains/user/hooks'
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
  usePlanMeshStreamRoute,
} from '@/domains/mesh/hooks'
import { useMeshSseState } from '@/domains/mesh/sse'
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
import '@xyflow/react/dist/style.css'
import {
  buildMeshEndpointUrl,
  buildRemoteSignInUrl,
  detectRemoteServer,
  fetchRemoteAuthSession,
  normalizeServerHttpUrl,
} from '@/domains/mesh/connect-flow'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
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
import { Building2, Users, Mail, AlertCircle, Network, PlugZap, Unplug } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
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

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">System Dashboard</h1>
        <p className="text-muted-foreground">
          Overview of all organizations, users, and invitations in the system.
        </p>
      </div>

      {/* System Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" />
              Total Users
            </CardTitle>
          </CardHeader>
          <CardContent>
            {usersLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{users.length}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Organizations
            </CardTitle>
          </CardHeader>
          <CardContent>
            {orgsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{organizations?.length ?? 0}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Total Invitations
            </CardTitle>
          </CardHeader>
          <CardContent>
            {invitesLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{pendingInvitations?.length ?? 0}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Pending Invites
            </CardTitle>
          </CardHeader>
          <CardContent>
            {invitesLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{pendingInvitations?.length ?? 0}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Network className="h-4 w-4" />
              Mesh Peers
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isMeshStateLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{peers.length}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Network className="h-4 w-4" />
              Event Sync
            </CardTitle>
          </CardHeader>
          <CardContent>
            {meshEventStreamsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="space-y-1">
                <div className="text-2xl font-bold">{activeMeshEventStreams}</div>
                <p className="text-xs text-muted-foreground">
                  {activeMeshEventStreams} active / {meshEventStreams.length} known streams
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
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
                  <Skeleton className="h-24 w-full" />
                ) : fleetServers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No fleet servers registered yet.</p>
                ) : (
                  <div className="space-y-2">
                    {fleetServers.map((server) => {
                      const isEditingCapacity = capacityEditNodeId === server.nodeId
                      const usedCpu = server.allocationSummary.cpuMillicores
                      const usedMem = server.allocationSummary.memoryMb
                      const maxCpu = server.maxCpuMillicores
                      const maxMem = server.maxMemoryMb
                      const cpuPct = maxCpu != null && maxCpu > 0 ? Math.min(100, Math.round((usedCpu / maxCpu) * 100)) : null
                      const memPct = maxMem != null && maxMem > 0 ? Math.min(100, Math.round((usedMem / maxMem) * 100)) : null

                      return (
                        <div key={server.nodeId} className="rounded border p-2 text-xs space-y-1">
                          <p className="font-mono break-all">{server.nodeId}</p>
                          <p className="text-muted-foreground break-all">{server.serverUrl}</p>
                          <p>
                            status <span className="font-semibold">{server.status}</span> · healthy{' '}
                            <span className="font-semibold">{String(server.healthy)}</span>
                          </p>
                          <p>
                            allocated: {String(usedCpu)}m CPU
                            {maxCpu != null ? ` / ${String(maxCpu)}m` : ''}
                            {cpuPct != null ? (
                              <span className={cpuPct >= 90 ? ' text-red-500' : cpuPct >= 70 ? ' text-yellow-500' : ' text-green-500'}> ({String(cpuPct)}%)</span>
                            ) : null}
                            {' · '}{String(usedMem)}MB RAM
                            {maxMem != null ? ` / ${String(maxMem)}MB` : ''}
                            {memPct != null ? (
                              <span className={memPct >= 90 ? ' text-red-500' : memPct >= 70 ? ' text-yellow-500' : ' text-green-500'}> ({String(memPct)}%)</span>
                            ) : null}
                            {' · '}{String(server.allocationSummary.organizations)} org(s)
                          </p>
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

      <Card>
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

      {/* Organizations Table */}
      <Card>
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
                      <Link
                        href={`/dashboard/organizations/${org.id}`}
                        className="text-sm text-primary hover:underline"
                      >
                        View Details
                      </Link>
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
        <Card>
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
      <Card>
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
    </div>
  )
}
