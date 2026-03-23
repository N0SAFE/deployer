'use client'

import Link from 'next/link'
import { useMeshSseState } from '@/domains/mesh/sse'
import { useOrganizations } from '@/domains/organization/hooks'
import { useEffect, useMemo, useState } from 'react'
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
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Separator } from '@repo/ui/components/shadcn/separator'
import { Building2, Cpu, ExternalLink, MemoryStick, Network, Server, Shield, Trash2 } from 'lucide-react'

type QuotaRecord = {
  organizationId: string
  organizationName: string
  serverKey: string
  serverLabel: string
  cpuMillicores: number
  ramMb: number
  updatedAt: string
}

const QUOTA_STORAGE_KEY = 'superadmin:organization-server-quotas:v1'

function deriveServerLabel(endpointUrl: string, peerNodeId: string | null): string {
  try {
    const parsed = new URL(endpointUrl)
    const nodeSuffix = peerNodeId ? ` (${peerNodeId.slice(0, 8)})` : ''
    return `${parsed.origin}${nodeSuffix}`
  } catch {
    return peerNodeId ? `${endpointUrl} (${peerNodeId.slice(0, 8)})` : endpointUrl
  }
}

function toServerKey(endpointUrl: string): string {
  try {
    return new URL(endpointUrl).origin
  } catch {
    return endpointUrl
  }
}

export default function AdminServersPage() {
  const { state: meshEvent, status, lastError } = useMeshSseState()
  const { data: organizations, isLoading: organizationsLoading } = useOrganizations()

  const localNode = meshEvent?.localNode
  const sessions = meshEvent?.sessions ?? []
  const snapshot = meshEvent?.snapshot
  const peers = meshEvent?.peers ?? []

  const [selectedOrganizationId, setSelectedOrganizationId] = useState('')
  const [selectedServerKey, setSelectedServerKey] = useState('')
  const [cpuMillicores, setCpuMillicores] = useState('500')
  const [ramMb, setRamMb] = useState('512')
  const [quotas, setQuotas] = useState<QuotaRecord[]>([])

  const serverOptions = useMemo(() => {
    const map = new Map<string, { key: string; label: string; sessionState: string }>()

    for (const session of sessions) {
      const key = toServerKey(session.endpointUrl)
      map.set(key, {
        key,
        label: deriveServerLabel(session.endpointUrl, session.peerNodeId),
        sessionState: session.state,
      })
    }

    if (localNode) {
      map.set(localNode.nodeId, {
        key: localNode.nodeId,
        label: `Local instance (${localNode.nodeId.slice(0, 8)})`,
        sessionState: 'connected',
      })
    }

    return Array.from(map.values())
  }, [localNode, sessions])

  useEffect(() => {
    const stored = globalThis.localStorage?.getItem(QUOTA_STORAGE_KEY)
    if (!stored) {
      return
    }

    try {
      const parsed = JSON.parse(stored) as QuotaRecord[]
      if (Array.isArray(parsed)) {
        setQuotas(parsed)
      }
    } catch {
      // ignore corrupted local storage payload
    }
  }, [])

  useEffect(() => {
    globalThis.localStorage?.setItem(QUOTA_STORAGE_KEY, JSON.stringify(quotas))
  }, [quotas])

  useEffect(() => {
    const firstOrganization = organizations?.[0]
    if (!selectedOrganizationId && firstOrganization) {
      setSelectedOrganizationId(firstOrganization.id)
    }
  }, [organizations, selectedOrganizationId])

  useEffect(() => {
    const firstServer = serverOptions[0]
    if (!selectedServerKey && firstServer) {
      setSelectedServerKey(firstServer.key)
    }
  }, [selectedServerKey, serverOptions])

  const metricsByTargetNode = useMemo(() => {
    const map = new Map<string, { latencyMs: number; jitterMs: number; packetLossRatio: number; reliabilityScore: number }>()

    for (const peer of peers) {
      map.set(peer.targetNodeId, {
        latencyMs: peer.metrics.latencyMs,
        jitterMs: peer.metrics.jitterMs,
        packetLossRatio: peer.metrics.packetLossRatio,
        reliabilityScore: peer.metrics.reliabilityScore,
      })
    }

    return map
  }, [peers])

  const orgVisibilityRows = useMemo(() => {
    const grouped = new Map<string, QuotaRecord[]>()

    for (const quota of quotas) {
      const existing = grouped.get(quota.organizationId) ?? []
      existing.push(quota)
      grouped.set(quota.organizationId, existing)
    }

    return Array.from(grouped.entries()).map(([organizationId, records]) => ({
      organizationId,
      organizationName: records[0]?.organizationName ?? organizationId,
      records,
    }))
  }, [quotas])

  const handleSaveQuota = () => {
    if (!selectedOrganizationId || !selectedServerKey || !organizations) {
      return
    }

    const organization = organizations.find((org) => org.id === selectedOrganizationId)
    const server = serverOptions.find((entry) => entry.key === selectedServerKey)

    if (!organization || !server) {
      return
    }

    const parsedCpu = Number(cpuMillicores)
    const parsedRam = Number(ramMb)

    if (!Number.isFinite(parsedCpu) || parsedCpu <= 0 || !Number.isFinite(parsedRam) || parsedRam <= 0) {
      return
    }

    setQuotas((previous) => {
      const withoutExisting = previous.filter(
        (entry) => !(entry.organizationId === organization.id && entry.serverKey === server.key),
      )

      const next: QuotaRecord = {
        organizationId: organization.id,
        organizationName: organization.name,
        serverKey: server.key,
        serverLabel: server.label,
        cpuMillicores: parsedCpu,
        ramMb: parsedRam,
        updatedAt: new Date().toISOString(),
      }

      return [next, ...withoutExisting]
    })
  }

  const handleDeleteQuota = (organizationId: string, serverKey: string) => {
    setQuotas((previous) => previous.filter((entry) => !(entry.organizationId === organizationId && entry.serverKey === serverKey)))
  }

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">Super Admin Fleet Manager</h1>
        <p className="text-muted-foreground">
          Connect servers, assign organization CPU/RAM quotas per server, and expose allowed capacity clearly.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Server className="h-4 w-4" /> Local Server
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground font-mono break-all">{localNode?.nodeId ?? 'n/a'}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Network className="h-4 w-4" /> Connected Servers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{serverOptions.length}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Shield className="h-4 w-4" /> Mesh Stream
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={status === 'connected' ? 'default' : status === 'error' ? 'destructive' : 'secondary'}>
              {status}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Building2 className="h-4 w-4" /> Organizations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{organizations?.length ?? 0}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Configured Quotas</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{quotas.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Architecture guardrails (current scope)</CardTitle>
          <CardDescription>
            One instance uses one database, and the load balancer uses its host instance database. Super admin manages server links + org quotas only.
          </CardDescription>
        </CardHeader>
      </Card>

      {lastError ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Mesh stream error</CardTitle>
            <CardDescription>{lastError}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Connected server inventory</CardTitle>
          <CardDescription>
            Server-level transport and quality view used by super admin to decide allocations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Server</TableHead>
                <TableHead>Session</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Endpoint / Key</TableHead>
                <TableHead>Link Quality</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {serverOptions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No connected server yet. Use Mesh Control Panel to connect a peer.
                  </TableCell>
                </TableRow>
              ) : (
                sessions.map((session) => {
                  const metrics = session.peerNodeId ? metricsByTargetNode.get(session.peerNodeId) : undefined

                  return (
                  <TableRow key={session.sessionId}>
                    <TableCell className="font-mono text-xs break-all">{deriveServerLabel(session.endpointUrl, session.peerNodeId)}</TableCell>
                    <TableCell className="font-mono text-xs break-all">{session.sessionId.slice(0, 8)}</TableCell>
                    <TableCell>
                      <Badge variant={session.state === 'connected' ? 'default' : session.state === 'reconnecting' ? 'secondary' : 'outline'}>
                        {session.state}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs break-all">{toServerKey(session.endpointUrl)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {metrics
                        ? `lat ${metrics.latencyMs}ms · jit ${metrics.jitterMs}ms · loss ${(metrics.packetLossRatio * 100).toFixed(1)}% · rel ${(metrics.reliabilityScore * 100).toFixed(0)}%`
                        : 'No telemetry yet'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="outline" size="sm" className="gap-2">
                        <Link href="/dashboard/admin/system">
                          Open mesh panel
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                )})
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Organization → Server quota manager</CardTitle>
          <CardDescription>
            Set allowed CPU/RAM for each organization on each connected server.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="organization-select">Organization</Label>
              <select
                id="organization-select"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={selectedOrganizationId}
                onChange={(event) => {
                  setSelectedOrganizationId(event.target.value)
                }}
                disabled={organizationsLoading || !organizations || organizations.length === 0}
              >
                {(organizations ?? []).map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="server-select">Server</Label>
              <select
                id="server-select"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={selectedServerKey}
                onChange={(event) => {
                  setSelectedServerKey(event.target.value)
                }}
                disabled={serverOptions.length === 0}
              >
                {serverOptions.map((server) => (
                  <option key={server.key} value={server.key}>
                    {server.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end">
              <Button
                type="button"
                className="w-full"
                onClick={handleSaveQuota}
                disabled={!selectedOrganizationId || !selectedServerKey}
              >
                Save quota
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cpu-input" className="flex items-center gap-2">
                <Cpu className="h-4 w-4" /> CPU limit (millicores)
              </Label>
              <Input
                id="cpu-input"
                type="number"
                min={100}
                step={100}
                value={cpuMillicores}
                onChange={(event) => {
                  setCpuMillicores(event.target.value)
                }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ram-input" className="flex items-center gap-2">
                <MemoryStick className="h-4 w-4" /> RAM limit (MB)
              </Label>
              <Input
                id="ram-input"
                type="number"
                min={128}
                step={128}
                value={ramMb}
                onChange={(event) => {
                  setRamMb(event.target.value)
                }}
              />
            </div>
          </div>

          <Separator />

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Server</TableHead>
                <TableHead>CPU (millicores)</TableHead>
                <TableHead>RAM (MB)</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No quotas configured yet.
                  </TableCell>
                </TableRow>
              ) : (
                quotas.map((quota) => (
                  <TableRow key={`${quota.organizationId}:${quota.serverKey}`}>
                    <TableCell className="font-medium">{quota.organizationName}</TableCell>
                    <TableCell className="text-xs font-mono break-all">{quota.serverLabel}</TableCell>
                    <TableCell>{quota.cpuMillicores}</TableCell>
                    <TableCell>{quota.ramMb}</TableCell>
                    <TableCell>{new Date(quota.updatedAt).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          handleDeleteQuota(quota.organizationId, quota.serverKey)
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Organization visibility preview</CardTitle>
          <CardDescription>
            What organizations will see as allowed CPU/RAM by server.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {orgVisibilityRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No organization allocation is visible yet.</p>
          ) : (
            orgVisibilityRows.map((orgGroup) => (
              <div key={orgGroup.organizationId} className="rounded border p-4 space-y-3">
                <p className="font-semibold">{orgGroup.organizationName}</p>
                <div className="space-y-2">
                  {orgGroup.records.map((record) => (
                    <div
                      key={`${record.organizationId}:${record.serverKey}`}
                      className="flex items-center justify-between gap-3 rounded border p-3 text-sm"
                    >
                      <span className="font-mono text-xs break-all">{record.serverLabel}</span>
                      <span className="text-muted-foreground">
                        CPU {record.cpuMillicores}m · RAM {record.ramMb}MB
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Metric usage panel (current source)</CardTitle>
          <CardDescription>
            Current panel displays mesh link quality telemetry. Per-server CPU/RAM usage snapshots will be wired from persisted server metrics next.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Membership revision: <span className="font-semibold">{snapshot?.version ?? 0}</span>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
