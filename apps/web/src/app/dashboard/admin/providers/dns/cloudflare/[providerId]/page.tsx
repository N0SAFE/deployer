'use client'

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useSafeQueryParamStatesFromZod } from '@repo/use-safe-query-param-states-from-zod'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import {
  Cloud,
  ArrowLeft,
  Globe,
  Network,
  ShieldCheck,
  ShieldAlert,
  Search,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Tag,
  Copy,
  Siren,
  Pencil,
  Star,
} from 'lucide-react'
import { toast } from 'sonner'
import { AuthDashboardAdminProvidersDnsCloudflare } from '@/routes'
import { z } from 'zod/v4'
import {
  useDNSProviders,
  useCloudflareZones,
  useCloudflareRecords,
  useCloudflareTunnels,
  useCloudflareCreateTunnel,
  useCloudflareDeleteTunnel,
  useCloudflareGetTunnelToken,
  useCloudflareCreateRecord,
  useCloudflareDeleteRecord,
} from '@/domains/dns-providers/hooks'
import { useListNodeNetworkConfigs } from '@/domains/reachability/hooks'
import { useFleetServers } from '@/domains/fleet/hooks'
import { useMeshSseState } from '@/domains/mesh/hooks'

const PAGE_SIZE = 25

const RECORD_TYPES = ['A', 'AAAA', 'CAA', 'CERT', 'CNAME', 'DNSKEY', 'DS', 'HTTPS', 'LOC', 'MX', 'NAPTR', 'NS', 'OPENPGPKEY', 'PTR', 'SMIMEA', 'SRV', 'SVCB', 'TLSA', 'TXT', 'URI'] as const

type RecordType = (typeof RECORD_TYPES)[number]

function toRecordType(value: string): RecordType | undefined {
  return (RECORD_TYPES as readonly string[]).includes(value) ? (value as RecordType) : undefined
}

const recordsQuerySchema = z.object({
  zone: z.string().optional(),
  type: z.enum(RECORD_TYPES).optional(),
  q: z.string().optional(),
  page: z.number().int().min(1).optional(),
})

interface TunnelRow {
  id: string
  name: string | null
  status: 'inactive' | 'degraded' | 'healthy' | 'down' | null
  tunType: string | null
  createdAt: string | null
  connections: Array<{
    id: string | null
    coloName: string | null
    isPendingReconnect: boolean | null
    openedAt: string | null
  }>
}

export default function CloudflareAppDetailPage() {
  return <CloudflareAppDetailInner />
}

function CloudflareAppDetailInner() {
  const params = useParams<{ providerId: string }>()
  const providerId = params.providerId

  const { data: providersData } = useDNSProviders()
  const app = providersData?.providers.find((p: { id: string }) => p.id === providerId)
  const { data: fleetData } = useFleetServers()
  const { data: nodeConfigsData } = useListNodeNetworkConfigs()
  const { state: meshState } = useMeshSseState()
  const currentNodeId = meshState?.localNode?.nodeId ?? ''

  const [filters, setFilters] = useSafeQueryParamStatesFromZod(recordsQuerySchema, { delay: 200 })
  const zoneId = filters.zone ?? ''
  const page = filters.page ?? 1

  // ─── Records ───────────────────────────────────────────────────────────────
  const { data: zonesData, isLoading: zonesLoading } = useCloudflareZones(providerId)
  const zones = zonesData?.zones ?? []
  const zonesError = (zonesData as { error?: string | null } | undefined)?.error ?? null
  const { data: recordsData, isLoading: recordsLoading } = useCloudflareRecords(providerId, zoneId, {
    type: filters.type,
    name: filters.q,
    page,
    pageSize: PAGE_SIZE,
  })

  const records = recordsData?.records ?? []
  const total = recordsData?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const recordsError = (recordsData as { error?: string | null } | undefined)?.error ?? null

  // ─── Tunnels ───────────────────────────────────────────────────────────────
  const { data: tunnelsData } = useCloudflareTunnels(providerId)
  const tunnels = (tunnelsData?.tunnels ?? []) as TunnelRow[]
  const tunnelsError = (tunnelsData as { error?: string | null } | undefined)?.error ?? null
  const createTunnel = useCloudflareCreateTunnel()
  const deleteTunnel = useCloudflareDeleteTunnel()
  const getToken = useCloudflareGetTunnelToken()

  const [createOpen, setCreateOpen] = useState(false)
  const [tunnelName, setTunnelName] = useState('')
  // Tunnel hostname is assembled from a selected ZONE + optional SUBDOMAIN:
  //   hostname = `${subdomain}.${zoneName}` (bare zone apex when no subdomain).
  // The zone is picked from the Cloudflare account; the server creates the
  // CNAME on that zone when it is covered.
  const [tunnelZoneId, setTunnelZoneId] = useState('')
  const [tunnelSubdomain, setTunnelSubdomain] = useState('')
  const selectedZone = zones.find((z) => z.id === tunnelZoneId)
  const derivedTunnelHostname = selectedZone
    ? tunnelSubdomain.trim()
      ? `${tunnelSubdomain.trim()}.${selectedZone.name}`
      : selectedZone.name
    : ''
  const [tokenFor, setTokenFor] = useState<TunnelRow | null>(null)
  const [tokenValue, setTokenValue] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // ─── DNS record editing ───────────────────────────────────────────────────
  const createRecord = useCloudflareCreateRecord()
  const deleteRecord = useCloudflareDeleteRecord()

  const [recordDialog, setRecordDialog] = useState<{
    open: boolean
    // When set, we "edit" an existing record = create a replacement with the
    // same name after deleting the old one (Cloudflare has no update surface
    // exposed here).
    editing: {
      id: string
      type: string
      name: string
      content: string
      ttl: number
      proxied?: boolean
    } | null
    type: string
    name: string
    content: string
    ttl: string
    proxied: boolean
    saving: boolean
  }>({
    open: false,
    editing: null,
    type: 'A',
    name: '',
    content: '',
    ttl: '',
    proxied: true,
    saving: false,
  })

  const openCreateRecord = () => {
    setRecordDialog({ open: true, editing: null, type: 'A', name: '', content: '', ttl: '', proxied: true, saving: false })
  }

  const openEditRecord = (record: { id: string; type: string; name: string; content: string; ttl: number; proxied?: boolean }) => {
    setRecordDialog({
      open: true,
      editing: { id: record.id, type: record.type, name: record.name, content: record.content, ttl: record.ttl, proxied: record.proxied },
      type: record.type,
      name: record.name,
      content: record.content,
      ttl: record.ttl === 1 ? '' : String(record.ttl),
      proxied: record.proxied ?? false,
      saving: false,
    })
  }

  const saveRecord = async () => {
    const name = recordDialog.name.trim()
    const content = recordDialog.content.trim()
    if (!zoneId || !name || !content) {
      toast.error('Name and content are required')
      return
    }
    const ttl = recordDialog.ttl.trim() ? Number(recordDialog.ttl.trim()) : 1
    if (!Number.isFinite(ttl) || ttl < 1) {
      toast.error('TTL must be a positive number (or empty for auto)')
      return
    }
    const body = { type: recordDialog.type as 'A' | 'AAAA' | 'CNAME' | 'TXT', name, content, ttl, proxied: recordDialog.proxied }
    setRecordDialog((s) => ({ ...s, saving: true }))
    try {
      // Edit = delete the previous record, then create the replacement with
      // the same name (keeps the row's identity while updating values).
      if (recordDialog.editing) {
        await deleteRecord.mutateAsync({
          params: { providerId, zoneId, id: recordDialog.editing.id },
        })
      }
      await createRecord.mutateAsync({ params: { providerId, zoneId }, body })
      toast.success(recordDialog.editing ? 'Record updated' : 'Record created')
      setRecordDialog((s) => ({ ...s, open: false, editing: null }))
    } catch (err) {
      toast.error('Failed to save record', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    } finally {
      setRecordDialog((s) => ({ ...s, saving: false }))
    }
  }

  const removeRecord = async (record: { id: string; name: string }) => {
    if (!zoneId) return
    try {
      await deleteRecord.mutateAsync({ params: { providerId, zoneId, id: record.id } })
      toast.success(`Record deleted`)
    } catch (err) {
      toast.error('Failed to delete record', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    }
  }

  // Which node uses each tunnel (System → Node Network binding).
  const nodeBindings = useMemo(() => {
    const bindings = new Map<string, { nodeId: string; displayName: string }>()
    const nodeNames = new Map<string, string>()
    for (const server of (fleetData?.items ?? []) as Array<{ nodeId: string; displayName: string | null }>) {
      if (server.nodeId) nodeNames.set(server.nodeId, server.displayName ?? server.nodeId)
    }
    for (const config of (nodeConfigsData?.configs ?? []) as Array<{
      nodeId: string
      tunnel: { providerId: string | null; tunnelId: string | null }
    }>) {
      if (config.tunnel.providerId === providerId && config.tunnel.tunnelId) {
        bindings.set(config.tunnel.tunnelId, {
          nodeId: config.nodeId,
          displayName: nodeNames.get(config.nodeId) ?? config.nodeId,
        })
      }
    }
    return bindings
  }, [providerId, fleetData, nodeConfigsData])

  const handleCreateTunnel = async () => {
    if (!selectedZone) {
      toast.error('Select a zone for the tunnel hostname.')
      return
    }
    try {
      const result = await createTunnel.mutateAsync({
        params: { providerId },
        body: {
          name: tunnelName.trim() || `deployer-tunnel-${Date.now().toString().slice(-6)}`,
          hostname: derivedTunnelHostname || undefined,
        },
      })
      toast.success(`Tunnel "${result.tunnel.name}" created`)
      setCreateOpen(false)
      setTunnelName('')
      setTunnelZoneId('')
      setTunnelSubdomain('')
    } catch (err) {
      toast.error('Failed to create tunnel', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    }
  }

  const handleDeleteTunnel = async () => {
    if (!deleteId) return
    try {
      await deleteTunnel.mutateAsync({ params: { providerId, id: deleteId } })
      toast.success('Tunnel deleted')
      setDeleteOpen(false)
      setDeleteId(null)
    } catch (err) {
      toast.error('Failed to delete tunnel', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    }
  }

  // The tunnel pending deletion (for the confirm dialog warning).
  const deletingTunnelBinding = deleteId ? nodeBindings.get(deleteId) ?? null : null

  const handleGetToken = async (tunnel: TunnelRow) => {
    try {
      const result = await getToken.mutateAsync({ params: { providerId, id: tunnel.id } })
      setTokenFor(tunnel)
      setTokenValue(result.token)
    } catch (err) {
      toast.error('Failed to fetch token', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    }
  }

  const copyToken = async () => {
    if (!tokenValue) return
    await navigator.clipboard.writeText(tokenValue)
    toast.success('Tunnel token copied')
  }

  if (!app) {
    return (
      <div className="space-y-6">
        <BackLink />
        <Alert variant="destructive"><Siren className="size-4" /><AlertTitle>App not found</AlertTitle><AlertDescription>This Cloudflare app no longer exists.</AlertDescription></Alert>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <BackLink />

      <div className="flex items-center gap-2">
        <Cloud className="size-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{app.name}</h1>
          <p className="text-sm text-muted-foreground">
            Cloudflare app — DNS records and tunnels. State is checked at runtime.
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          {app.state?.status === 'ok' && <Badge variant="default" className="gap-1"><ShieldCheck className="size-3" /> Connected</Badge>}
          {app.state?.status === 'error' && <Badge variant="destructive" className="gap-1" title={app.state.error ?? undefined}><ShieldAlert className="size-3" /> Error</Badge>}
          {app.features.tunnelManagement && <Badge variant="secondary" className="gap-1"><Network className="size-3" /> Tunnel management</Badge>}
        </div>
      </div>

      <Tabs defaultValue="records">
        <TabsList>
          <TabsTrigger value="records" className="gap-2"><Globe className="h-4 w-4" /> DNS Records</TabsTrigger>
          <TabsTrigger value="tunnels" className="gap-2"><Network className="h-4 w-4" /> Tunnels</TabsTrigger>
        </TabsList>

        {/* ─── Records tab ─────────────────────────────────────────────────── */}
        <TabsContent value="records" className="space-y-4">
          {!app.features.dnsManagement ? (
            <Alert>
              <Globe className="size-4" />
              <AlertTitle>DNS management is off</AlertTitle>
              <AlertDescription>Enable DNS management in the app configuration to browse zones and records.</AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-52 space-y-1.5">
                  <Label>Zone</Label>
                  {zonesError && !zonesLoading ? (
                    <p className="text-xs text-destructive leading-relaxed">
                      Could not list zones: {zonesError}
                    </p>
                  ) : (
                    <Select value={zoneId} onValueChange={(v) => setFilters({ zone: v || undefined, page: 1 })}>
                      <SelectTrigger><SelectValue placeholder={zonesLoading ? 'Loading zones…' : 'Select a zone'} /></SelectTrigger>
                      <SelectContent>
                        {zones.length === 0 && <SelectItem value="__none__" disabled>No zones on this account</SelectItem>}
                        {zones.map((zone: { id: string; name: string }) => (
                          <SelectItem key={zone.id} value={zone.id}>{zone.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div className="min-w-40 space-y-1.5">
                  <Label>Type</Label>
                  <Select value={filters.type ?? ''} onValueChange={(v) => setFilters({ type: v === '__all__' ? undefined : toRecordType(v), page: 1 })}>
                    <SelectTrigger><SelectValue placeholder="All types" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All types</SelectItem>
                      {RECORD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-56 flex-1 space-y-1.5">
                  <Label>Record name</Label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-8"
                      placeholder="Search record name (exact)"
                      value={filters.q ?? ''}
                      onChange={(e) => setFilters({ q: e.target.value || undefined, page: 1 })}
                    />
                  </div>
                </div>
                <Button size="sm" className="ml-auto" disabled={!zoneId} onClick={openCreateRecord}>
                  <Plus className="mr-2 size-4" />New record
                </Button>
              </div>

              <Card>
                <CardContent className="p-0">
                  {!zoneId ? (
                    <div className="py-12 text-center text-sm text-muted-foreground">Select a zone to list its records.</div>
                  ) : recordsError ? (
                    <Alert variant="destructive" className="m-4 border-0">
                      <Siren className="size-4" />
                      <AlertTitle>Could not load records</AlertTitle>
                      <AlertDescription>{recordsError}</AlertDescription>
                    </Alert>
                  ) : recordsLoading ? (
                    <div className="space-y-2 p-4"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
                  ) : records.length === 0 ? (
                    <div className="py-12 text-center text-sm text-muted-foreground">No records match these filters.</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead className="w-24">Type</TableHead>
                          <TableHead>Content</TableHead>
                          <TableHead className="w-20">TTL</TableHead>
                          <TableHead className="w-24">Proxy</TableHead>
                          <TableHead className="w-16" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {records.map((record: { id: string; type: string; name: string; content: string; ttl: number; proxied?: boolean }) => (
                          <TableRow key={record.id}>
                            <TableCell className="font-mono text-xs">{record.name}</TableCell>
                            <TableCell><Badge variant="outline">{record.type}</Badge></TableCell>
                            <TableCell className="max-w-64 truncate font-mono text-xs" title={record.content}>{record.content}</TableCell>
                            <TableCell className="text-xs">{record.ttl === 1 ? 'Auto' : record.ttl}</TableCell>
                            <TableCell>{record.proxied ? <Badge variant="secondary">Proxied</Badge> : <span className="text-xs text-muted-foreground">DNS only</span>}</TableCell>
                            <TableCell className="w-24">
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => openEditRecord(record)} title="Edit record">
                                  <Pencil className="size-3.5" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive" onClick={() => removeRecord(record)} title="Delete record">
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
                {zoneId && (
                  <div className="flex items-center justify-between border-t px-4 py-3">
                    <p className="text-xs text-muted-foreground">{total} record{total !== 1 ? 's' : ''}</p>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setFilters({ page: page - 1 })}><ChevronLeft className="size-4" /></Button>
                      <span className="text-xs text-muted-foreground">{page} / {totalPages}</span>
                      <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setFilters({ page: page + 1 })}><ChevronRight className="size-4" /></Button>
                    </div>
                  </div>
                )}
              </Card>
            </>
          )}
        </TabsContent>

        {/* ─── Tunnels tab ─────────────────────────────────────────────────── */}
        <TabsContent value="tunnels" className="space-y-4">
          {!app.features.tunnelManagement ? (
            <Alert>
              <Network className="size-4" />
              <AlertTitle>Tunnel management is off</AlertTitle>
              <AlertDescription>Enable "Tunnel management" in the app configuration to create and manage tunnels here.</AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Tunnels hosted by this app. Tunnels bound to a node in System → Node Network are tagged below.
                </p>
                <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-2 size-4" />Create tunnel</Button>
              </div>

              {tunnels.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                    <Network className="size-10 text-muted-foreground" />
                    <p className="font-medium">No tunnel yet</p>
                    <p className="text-sm text-muted-foreground">Create a tunnel to route a node through Cloudflare.</p>
                  </CardContent>
                </Card>
              ) : tunnelsError ? (
                <Alert variant="destructive">
                  <Siren className="size-4" />
                  <AlertTitle>Could not load tunnels</AlertTitle>
                  <AlertDescription>{tunnelsError}</AlertDescription>
                </Alert>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {tunnels.map((tunnel) => {
                    const binding = nodeBindings.get(tunnel.id)
                    const activeConnections = tunnel.connections.filter((c) => !c.isPendingReconnect).length
                    // The deployer platform's own tunnel = the one bound to the
                    // CURRENT node's network config (this web/api instance). Only
                    // that tunnel is the "global" tunnel; other unbound tunnels
                    // are plain account tunnels and must NOT be highlighted.
                    const isGlobal = binding?.nodeId === currentNodeId
                    return (
                      <Card
                        key={tunnel.id}
                        className={isGlobal ? 'border-primary/60 bg-primary/4 ring-1 ring-primary/25' : ''}
                      >
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Network className="size-4 text-primary" />
                              <CardTitle className="text-base font-mono">{tunnel.name ?? tunnel.id.slice(0, 8)}</CardTitle>
                              {isGlobal && (
                                <Badge variant="default" className="gap-1">
                                  <Star className="size-3" /> Global tunnel
                                </Badge>
                              )}
                            </div>
                            <TunnelStatusBadge status={tunnel.status} />
                          </div>
                          <CardDescription className="font-mono text-xs">{tunnel.id}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {/* Node binding tag — the tunnel used in System → Node Network */}
                          {binding && (
                            <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs">
                              <Tag className="size-3.5 text-primary" />
                              <span>
                                Used by node <strong>{binding.displayName}</strong> in System → Node Network
                              </span>
                            </div>
                          )}
                          {isGlobal && (
                            <p className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-primary">
                              <Star className="size-3.5" />
                              This is the deployer platform&apos;s tunnel — it routes the current node&apos;s public access.
                            </p>
                          )}
                          <div className="space-y-1.5 text-sm">
                            <p className="text-xs font-medium text-muted-foreground">
                              {activeConnections} active connection{activeConnections !== 1 ? 's' : ''}
                            </p>
                            {tunnel.connections.length === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                No cloudflared connector running — start it with the tunnel token to open connections.
                              </p>
                            ) : (
                              <div className="space-y-1">
                                {tunnel.connections.map((conn, idx) => (
                                  <div key={conn.id ?? idx} className="flex items-center gap-2 font-mono text-xs">
                                    <span className={`size-1.5 rounded-full ${conn.isPendingReconnect ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                                    {conn.coloName ?? 'unknown colo'}
                                    {conn.isPendingReconnect ? ' · reconnecting' : ' · connected'}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2 pt-1">
                            <Button size="sm" variant="outline" onClick={() => handleGetToken(tunnel)}><Copy className="mr-1 size-3.5" />Run token</Button>
                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => { setDeleteId(tunnel.id); setDeleteOpen(true) }}>
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Create / edit DNS record dialog */}
      <Dialog open={recordDialog.open} onOpenChange={(open) => { if (!open) setRecordDialog((s) => ({ ...s, open: false, editing: null })) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{recordDialog.editing ? 'Edit DNS record' : 'New DNS record'}</DialogTitle>
            <DialogDescription>
              {recordDialog.editing ? 'Saving replaces the record with updated values on the same name.' : 'Create a DNS record on the selected zone.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={recordDialog.type}
                onValueChange={(v) => setRecordDialog((s) => ({ ...s, type: v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['A', 'AAAA', 'CNAME', 'TXT'] as const).map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                className="font-mono text-xs"
                placeholder="app or sub.example.com"
                value={recordDialog.name}
                onChange={(e) => setRecordDialog((s) => ({ ...s, name: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">A bare name (e.g. <code className="font-mono">app</code>) resolves under the selected zone.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Content</Label>
              <Input
                className="font-mono text-xs"
                placeholder="203.0.113.10, hostname, TXT value…"
                value={recordDialog.content}
                onChange={(e) => setRecordDialog((s) => ({ ...s, content: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>TTL (seconds)</Label>
                <Input
                  className="font-mono text-xs"
                  placeholder="Auto"
                  value={recordDialog.ttl}
                  onChange={(e) => setRecordDialog((s) => ({ ...s, ttl: e.target.value }))}
                />
              </div>
              <div className="flex items-end pb-1">
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                  onClick={() => setRecordDialog((s) => ({ ...s, proxied: !s.proxied }))}
                  aria-pressed={recordDialog.proxied}
                >
                  <input type="checkbox" className="size-4 accent-primary" checked={recordDialog.proxied} readOnly />
                  Proxied (orange cloud)
                </button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecordDialog((s) => ({ ...s, open: false, editing: null }))}>Cancel</Button>
            <Button onClick={saveRecord} disabled={recordDialog.saving || createRecord.isPending || deleteRecord.isPending}>
              {recordDialog.saving ? 'Saving…' : recordDialog.editing ? 'Save changes' : 'Create record'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create tunnel dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Cloudflare Tunnel</DialogTitle>
            <DialogDescription>Auto-setup: the tunnel is created on Cloudflare, its run token is fetched, and an optional CNAME is added.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <Label>Tunnel name</Label>
              <Input placeholder="deployer-node" value={tunnelName} onChange={(e) => setTunnelName(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label>Zone</Label>
              {zonesLoading ? (
                <p className="text-xs text-muted-foreground">Loading zones…</p>
              ) : zonesError ? (
                <p className="text-xs text-destructive leading-relaxed">
                  Could not list zones: {zonesError} — check the app&apos;s Cloudflare token has Zone:Read permission.
                </p>
              ) : (
                <Select value={tunnelZoneId} onValueChange={setTunnelZoneId}>
                  <SelectTrigger><SelectValue placeholder="Select a zone in this account" /></SelectTrigger>
                  <SelectContent>
                    {zones.length === 0 && <SelectItem value="__none__" disabled>No zones on this account</SelectItem>}
                    {zones.map((zone: { id: string; name: string }) => (
                      <SelectItem key={zone.id} value={zone.id}>{zone.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Subdomain (optional)</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  className="flex-1 font-mono text-xs"
                  placeholder="node"
                  value={tunnelSubdomain}
                  onChange={(e) => setTunnelSubdomain(e.target.value)}
                  disabled={!selectedZone}
                />
                <span className="text-xs text-muted-foreground">.{selectedZone?.name ?? 'zone'}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {selectedZone
                  ? tunnelSubdomain.trim()
                    ? <>The tunnel will be reachable at <code className="font-mono rounded bg-background/60 px-1 py-0.5">{derivedTunnelHostname}</code>, with the CNAME created on <strong>{selectedZone.name}</strong>.</>
                    : <>No subdomain — the CNAME will be on the zone apex <code className="font-mono rounded bg-background/60 px-1 py-0.5">{selectedZone.name}</code>.</>
                  : 'Select a zone to pick a subdomain on it. The CNAME is created automatically when the hostname is covered by a zone on this account.'}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateTunnel} disabled={createTunnel.isPending}>
              {createTunnel.isPending ? 'Creating…' : 'Create tunnel'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tunnel token dialog */}
      <Dialog open={tokenFor !== null} onOpenChange={(open) => { if (!open) { setTokenFor(null); setTokenValue(null) } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Run tunnel {tokenFor?.name ?? ''}</DialogTitle>
            <DialogDescription>Use this token to start cloudflared on the node hosting this tunnel.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="relative">
              <code className="block max-h-40 overflow-auto rounded-md bg-muted p-3 font-mono text-xs break-all">{tokenValue ?? 'Fetching token…'}</code>
              {tokenValue && (
                <Button size="sm" variant="outline" className="absolute right-2 top-2" onClick={copyToken}><Copy className="size-3.5" /></Button>
              )}
            </div>
            <ol className="list-decimal list-inside space-y-1 text-xs text-muted-foreground">
              <li><code className="rounded bg-muted px-1 py-0.5 font-mono">cloudflared tunnel --no-autoupdate run --token '&lt;TOKEN&gt;'</code></li>
              <li>Cloudflare reports the tunnel healthy once a connector connects.</li>
            </ol>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => { setTokenFor(null); setTokenValue(null) }}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete tunnel dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Delete tunnel</DialogTitle><DialogDescription>Delete this Cloudflare tunnel?</DialogDescription></DialogHeader>
          {deletingTunnelBinding ? (
            <Alert variant="destructive">
              <Siren className="size-4" />
              <AlertTitle>This tunnel routes node {deletingTunnelBinding.displayName}</AlertTitle>
              <AlertDescription>
                Deleting it will break the node&apos;s Cloudflare access. Disable the tunnel in System → Node Network instead —
                that path removes the tunnel and its DNS record together.
              </AlertDescription>
            </Alert>
          ) : (
            <p className="text-sm text-muted-foreground">
              The tunnel and its Cloudflare record are removed. Unbound tunnels hold no node configuration.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteTunnel} disabled={deleteTunnel.isPending}>
              {deleteTunnel.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function BackLink() {
  return (
    <div className="flex items-center gap-3">
      <AuthDashboardAdminProvidersDnsCloudflare.Link>
        <Button variant="ghost" size="sm" className="-ml-2"><ArrowLeft className="mr-1 size-4" />Cloudflare Apps</Button>
      </AuthDashboardAdminProvidersDnsCloudflare.Link>
    </div>
  )
}

function TunnelStatusBadge({ status }: { status: TunnelRow['status'] }) {
  if (status === 'healthy') return <Badge variant="default" className="gap-1"><ShieldCheck className="size-3" /> Healthy</Badge>
  if (status === 'degraded') return <Badge variant="secondary" className="gap-1">Degraded</Badge>
  if (status === 'down') return <Badge variant="destructive" className="gap-1"><ShieldAlert className="size-3" /> Down</Badge>
  return <Badge variant="outline">Inactive</Badge>
}
