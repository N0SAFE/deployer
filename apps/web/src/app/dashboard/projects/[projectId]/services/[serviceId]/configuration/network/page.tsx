'use client'

import type { RouteVisibility } from '@repo/contracts-entities/entities/ingress/index'
import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  useServiceNetwork,
  useUpdateServiceNetwork,
  useProvisionServiceDnsRecord,
} from '@/domains/service/hooks'
import { useDNSProviders, useCloudflareZones } from '@/domains/dns-providers/hooks'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import {
  Siren, Save, Network, Globe, Lock, Plus, Cloud, ShieldCheck, ArrowRight, Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { AuthDashboardNetworkDns, AuthDashboardNetworkIngress } from '@/routes'
import { ServiceConfigSubNav } from '../../_components/service-config-subnav'
import { ServiceDomainConfig } from '@/app/dashboard/projects/_components/ServiceDomainConfig'
import { AutocompleteField } from '@/app/dashboard/projects/_components/steps/autocomplete-field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/shadcn/dialog'

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'TXT'] as const

/**
 * Service Network — "How this service is reached": 1. visibility, 2. domains, 3. DNS.
 *
 * The service INHERITS its project's DNS provider + zone unless overridden
 * here. This page is driven by the DNS provider:
 *  - Pick the provider account + one of its zones (zone name = base domain).
 *  - Live zone DNS records are listed from the provider, and new records can
 *    be auto-provisioned (A/AAAA/CNAME/TXT) directly in the zone.
 *  - Already-registered project domains + their allowed subdomains are shown
 *    with autocomplete for this service's bindings.
 */
export default function DashboardServiceConfigurationNetworkPage() {
  const params = useParams<{ projectId: string; serviceId: string }>()
  const projectId = params.projectId
  const serviceId = params.serviceId

  const { data: view, isLoading: networkLoading } = useServiceNetwork(serviceId)
  const updateNetwork = useUpdateServiceNetwork()
  const provision = useProvisionServiceDnsRecord()
  const { data: providersData } = useDNSProviders()

  const providers = useMemo(() => {
    const d = providersData as unknown as { data?: { id: string; name: string; providerType: string; isActive: boolean }[] } | undefined
    return (d?.data ?? []).filter((p) => p.isActive)
  }, [providersData])

  // ── Local form state (seeded from the network view) ──────────────
  const [providerId, setProviderId] = useState<string>('')
  const [zoneId, setZoneId] = useState<string>('')
  const [zoneName, setZoneName] = useState<string>('')
  const [recordType, setRecordType] = useState<'A' | 'AAAA' | 'CNAME' | 'TXT'>('CNAME')
  const [recordContent, setRecordContent] = useState('')
  const [proxied, setProxied] = useState(true)
  const [autoProvision, setAutoProvision] = useState(false)
  const [visibility, setVisibility] = useState<RouteVisibility>('public')
  const [tlsEnabled, setTlsEnabled] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const network = (view as { network?: Record<string, unknown> | null } | undefined)?.network ?? null
  const resolvedProviderId = (view as { dnsProviderId?: string | null } | undefined)?.dnsProviderId ?? null
  const resolvedZoneId = (view as { zoneId?: string | null } | undefined)?.zoneId ?? null
  const resolvedZoneName = (view as { zoneName?: string | null } | undefined)?.zoneName ?? null

  // Overrides are active when the service's OWN network config pins a provider/zone.
  const overridesProvider = Boolean((network as { dnsProviderId?: string | null } | undefined)?.dnsProviderId)
  const overridesZone = Boolean((network as { zoneId?: string | null } | undefined)?.zoneId)

  useEffect(() => {
    if (!loaded && view) {
      const n = network as {
        dnsProviderId?: string | null
        zoneId?: string | null
        zoneName?: string | null
        recordType?: 'A' | 'AAAA' | 'CNAME' | 'TXT'
        recordContent?: string | null
        proxied?: boolean
        autoProvision?: boolean
        visibility?: RouteVisibility
        tls?: { enabled?: boolean }
      } | null
      // Seed with the service's OWN overrides only. When there is no override
      // the selects show the "Inherit (project default)" marker (computed from
      // overridesProvider/overridesZone), so state must be '' here — otherwise
      // saving would pin the resolved value as an accidental override.
      setProviderId(n?.dnsProviderId ?? '')
      setZoneId(n?.zoneId ?? '')
      setZoneName(n?.zoneName ?? '')
      setRecordType(n?.recordType ?? 'CNAME')
      setRecordContent(n?.recordContent ?? '')
      // `?? true` rendered Cloudflare proxying as ON for a service with no
      // network config, i.e. it asserted a setting that had never been made.
      setProxied(n?.proxied ?? false)
      setAutoProvision(n?.autoProvision ?? false)
      setVisibility(n?.visibility ?? 'public')
      setTlsEnabled(Boolean(n?.tls?.enabled))
      setLoaded(true)
    }
  }, [view, loaded, network, resolvedProviderId, resolvedZoneId, resolvedZoneName])

  // Zones for the currently-selected provider (override selection).
  const { data: zonesData, isLoading: zonesLoading } = useCloudflareZones(providerId || undefined)
  const zones = useMemo(() => {
    const d = zonesData as unknown as { zones?: { id: string; name: string; status?: string }[] } | null | undefined
    return d?.zones ?? []
  }, [zonesData])

  const records = (view as { records?: Array<{ id: string; name: string; type: string; content: string; ttl: number; proxied: boolean }> } | undefined)?.records ?? []
  const projectDomains = (view as { projectDomains?: Array<{ id: string; domain: string; allowedSubdomains: string[]; isPrimary: boolean; existingMappings: Array<{ serviceId: string; serviceName: string; subdomain: string | null; basePath: string | null; fullUrl: string }> }> } | undefined)?.projectDomains ?? []

  const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? id

  // "Inherit (project default)" marker — selecting it clears the override so
  // the service inherits the project-level provider/zone on save.
  const INHERIT = '__inherit__'

  if (networkLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  const handleSave = async () => {
    try {
      await updateNetwork.mutateAsync({
        params: { id: serviceId },
        body: {
          dnsProviderId: providerId || null,
          zoneId: zoneId || null,
          zoneName: zoneName || null,
          recordType,
          recordContent: recordContent.trim() || null,
          proxied,
          autoProvision,
          visibility,
          tls: { enabled: tlsEnabled, httpRedirect: true },
        },
      })
      toast.success('Network configuration saved')
    } catch (err) {
      toast.error('Failed to save network config', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    }
  }

  return (
    <div className="space-y-6">
      <ServiceConfigSubNav projectId={projectId} serviceId={serviceId} active="network" />

      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">How this service is reached</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Work top to bottom: choose its visibility, bind domains, then check the DNS records behind them. One Save applies
          visibility, TLS and DNS settings together; domain bindings are saved on their own.
        </p>
      </div>

      {/* ── 1. Visibility ── */}
      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Network className="size-4 text-muted-foreground" /> 1. Visibility
          </CardTitle>
          <CardDescription className="text-xs">Who can reach this service. This decides whether it gets a public route at all.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Visibility</Label>
              <Select value={visibility} onValueChange={(v) => setVisibility(v as RouteVisibility)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public — also reachable from the internet</SelectItem>
                  <SelectItem value="private">Private — this machine and the mesh</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Private: reachable from this machine and mesh members only. Public: also served on the public lane. Neither
                option publishes a host port. Stack-wide lanes are managed under Network → Ingress &amp; edge.
              </p>
            </div>
            <div className={`flex items-center justify-between rounded-lg border p-3 ${visibility === 'public' ? '' : 'opacity-50'}`}>
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium"><Lock className="size-3.5" /> TLS termination</p>
                <p className="text-xs text-muted-foreground">Terminate HTTPS at the edge. Public services only.</p>
              </div>
              <Switch checked={visibility === 'public' && tlsEnabled} onCheckedChange={(v) => { setTlsEnabled(v); if (v) setVisibility('public') }} disabled={visibility !== 'public'} />
            </div>
          </div>

        </CardContent>
      </Card>

      {/* ── Registered Domains ── */}
      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldCheck className="size-4 text-muted-foreground" /> 2. Domains
          </CardTitle>
          <CardDescription className="text-xs">
            The addresses people type to open this service. Pick one of the project&apos;s registered domains, then choose a subdomain and an optional path. Domains themselves are registered at project level.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {projectDomains.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No project domains registered yet. Register one on the project&apos;s Domains tab, then bind it here.</p>
          ) : (
            <div className="space-y-3">
              {projectDomains.map((pd) => (
                <div key={pd.id} className="rounded-lg border bg-background/40 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium">{pd.domain}</span>
                    {pd.isPrimary ? <Badge variant="secondary" className="text-[10px]">primary</Badge> : null}
                    <div className="ml-auto flex flex-wrap gap-1">
                      {pd.allowedSubdomains.map((s) => (
                        <Badge key={s} variant="outline" className="font-mono text-[10px]">{s}</Badge>
                      ))}
                    </div>
                  </div>
                  {pd.existingMappings.length > 0 ? (
                    <div className="mt-2 space-y-1 border-t pt-2">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Existing bindings</p>
                      {pd.existingMappings.map((m, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <Badge variant="outline" className="text-[10px]">{m.serviceName}</Badge>
                          <ArrowRight className="size-3 text-muted-foreground" />
                          <span className="font-mono text-muted-foreground">{m.fullUrl}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {/* Bindings management (subdomain + basePath, conflict-aware) */}
          <div className="border-t pt-4">
            <ServiceDomainConfig projectId={projectId} serviceId={serviceId} />
          </div>
        </CardContent>
      </Card>

      {/* ── DNS Provider & Zone ── */}
      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Cloud className="size-4 text-muted-foreground" /> 3. DNS provider &amp; zone
          </CardTitle>
          <CardDescription className="text-xs">
            Where DNS records for this service&apos;s domains are created. Inherits the project&apos;s provider and zone unless you override them; the zone name is the base domain.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Resolved context (inherited) */}
          {resolvedProviderId && !overridesProvider ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background/40 px-3 py-2 text-xs">
              <ShieldCheck className="size-3.5 text-emerald-500" />
              <span className="text-muted-foreground">Resolved (inherited from project):</span>
              <Badge variant="outline">{providerName(resolvedProviderId)}</Badge>
              {resolvedZoneName ? <Badge variant="outline">{resolvedZoneName}</Badge> : null}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Provider account</Label>
              <Select
                value={overridesProvider ? providerId : INHERIT}
                onValueChange={(v) => {
                  if (v === INHERIT) { setProviderId(''); setZoneId(''); setZoneName('') }
                  else { setProviderId(v); setZoneId(''); setZoneName('') }
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select a DNS provider…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={INHERIT}>Inherit (project default)</SelectItem>
                  {providers.length === 0 ? (
                    <SelectItem value="__none__" disabled>No active providers</SelectItem>
                  ) : (
                    providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name} ({p.providerType})</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {overridesProvider ? <Badge variant="secondary" className="text-[10px]">overriding project</Badge> : null}
            </div>
            <div className="space-y-1.5">
              <Label>Zone</Label>
              <Select
                value={overridesZone ? zoneId : INHERIT}
                onValueChange={(v) => {
                  if (v === INHERIT) { setZoneId(''); setZoneName('') }
                  else {
                    const z = zones.find((zone) => zone.id === v)
                    setZoneId(v)
                    setZoneName(z?.name ?? '')
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={zonesLoading ? 'Loading zones…' : providerId ? 'Select a zone…' : 'Pick a provider first'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={INHERIT}>Inherit (project default)</SelectItem>
                  {zones.length === 0 ? (
                    <SelectItem value="__none__" disabled>{zonesLoading ? 'Loading…' : 'No zones on this account'}</SelectItem>
                  ) : (
                    zones.map((z) => (
                      <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {overridesZone ? <Badge variant="secondary" className="text-[10px]">overriding project</Badge> : null}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Zone DNS Records ── */}
      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Globe className="size-4 text-muted-foreground" /> DNS records
            </CardTitle>
            <CardDescription className="text-xs">
              {zoneName ? `Live records in zone ${zoneName}.` : 'Select a zone above to see its DNS records.'}
            </CardDescription>
          </div>
          {zoneId ? (
            <ProvisionRecordDialog
              zoneName={zoneName}
              onProvision={async (payload) => {
                try {
                  const res = await provision.mutateAsync({ params: { id: serviceId }, body: payload })
                  toast.success(res.message ?? 'Record provisioned')
                  return true
                } catch (err) {
                  toast.error('Failed to provision record', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
                  return false
                }
              }}
              pending={provision.isPending}
            />
          ) : null}
        </CardHeader>
        <CardContent>
          {records.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {zoneId ? 'No records found in this zone, or the provider is unreachable. Check the provider account under Network → DNS.' : 'No zone resolved yet. Pick a provider and zone above (or set them on the project) to see records.'}
            </p>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Content</TableHead>
                    <TableHead>TTL</TableHead>
                    <TableHead>Proxy</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.name}</TableCell>
                      <TableCell><Badge variant="outline">{r.type}</Badge></TableCell>
                      <TableCell className="max-w-64 truncate font-mono text-xs text-muted-foreground">{r.content}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.ttl}</TableCell>
                      <TableCell>{r.proxied ? <Badge variant="secondary">proxied</Badge> : <Badge variant="outline">DNS only</Badge>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── DNS record defaults ── */}
      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Plus className="size-4 text-muted-foreground" /> DNS record defaults
          </CardTitle>
          <CardDescription className="text-xs">What gets created in the zone when a domain is bound to this service.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Record type</Label>
              <Select value={recordType} onValueChange={(v) => setRecordType(v as 'A' | 'AAAA' | 'CNAME' | 'TXT')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RECORD_TYPES.map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Record content</Label>
              <AutocompleteField
                value={recordContent}
                onChange={setRecordContent}
                options={['lb.internal', 'traefik.internal', 'localhost']}
                placeholder="Target for the provisioned record (e.g. load balancer hostname)"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Proxy through provider</p>
                <p className="text-xs text-muted-foreground">Cloudflare orange-cloud on provisioned records.</p>
              </div>
              <Switch checked={proxied} onCheckedChange={setProxied} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Auto-provision DNS</p>
                <p className="text-xs text-muted-foreground">Create the record automatically when a binding is saved.</p>
              </div>
              <Switch checked={autoProvision} onCheckedChange={setAutoProvision} />
            </div>
          </div>

        </CardContent>
      </Card>

      <Card className="border-dashed border-border/60 bg-card/20">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <p className="max-w-2xl text-xs text-muted-foreground">
            Public lanes, tunnels and entry ports apply to the whole stack, not to this service. Manage them under Network →
            Ingress &amp; edge; DNS provider accounts live under Network → DNS.
          </p>
          <div className="flex shrink-0 gap-2">
            <AuthDashboardNetworkIngress.Link>
              <Button variant="outline" size="sm">Ingress &amp; edge <ArrowRight className="ml-1.5 size-3.5" /></Button>
            </AuthDashboardNetworkIngress.Link>
            <AuthDashboardNetworkDns.Link>
              <Button variant="outline" size="sm">DNS <ArrowRight className="ml-1.5 size-3.5" /></Button>
            </AuthDashboardNetworkDns.Link>
          </div>
        </CardContent>
      </Card>

      <div>
        <Button size="sm" onClick={() => { void handleSave() }} disabled={updateNetwork.isPending}>
          <Save className="mr-1.5 size-3.5" /> {updateNetwork.isPending ? 'Saving…' : 'Save visibility & DNS settings'}
        </Button>
      </div>
    </div>
  )
}

/** Dialog to auto-provision a DNS record in the resolved zone. */
function ProvisionRecordDialog({
  zoneName,
  onProvision,
  pending,
}: {
  zoneName: string
  onProvision: (payload: { name: string; type: 'A' | 'AAAA' | 'CNAME' | 'TXT'; content: string; ttl?: number; proxied?: boolean }) => Promise<boolean>
  pending: boolean
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<'A' | 'AAAA' | 'CNAME' | 'TXT'>('CNAME')
  const [content, setContent] = useState('')
  const [ttl, setTtl] = useState('')
  const [proxied, setProxied] = useState(true)

  // Autocomplete presets: `sub.zone`, `@` (zone root), `*` (wildcard).
  const presets = useMemo(() => ['@', '*', `www.${zoneName}`], [zoneName])

  const handleProvision = async () => {
    if (!name.trim() || !content.trim()) {
      toast.error('Record name and content are required')
      return
    }
    const ok = await onProvision({
      name: name.trim(),
      type,
      content: content.trim(),
      ttl: ttl.trim() ? Number(ttl) : undefined,
      proxied,
    })
    if (ok) {
      setOpen(false)
      setName(''); setContent(''); setTtl('')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1.5 size-3.5" />Provision record</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Provision DNS record</DialogTitle>
          <DialogDescription>Create a record in zone <code className="font-mono">{zoneName}</code> via the DNS provider.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-1.5">
            <Label>Record name</Label>
            <AutocompleteField
              value={name}
              onChange={setName}
              options={presets}
              placeholder={`e.g. api or api.${zoneName}`}
              searchPlaceholder="Type a subdomain or full name…"
              allowCustom
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as 'A' | 'AAAA' | 'CNAME' | 'TXT')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RECORD_TYPES.map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>TTL (seconds)</Label>
              <Input type="number" value={ttl} onChange={(e) => setTtl(e.target.value)} placeholder="Auto" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Content</Label>
            <Input value={content} onChange={(e) => setContent(e.target.value)} placeholder={type === 'CNAME' ? 'target.example.com' : type === 'A' ? '1.2.3.4' : 'text value'} className="font-mono text-xs" />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Proxy through provider</p>
              <p className="text-xs text-muted-foreground">Cloudflare orange-cloud.</p>
            </div>
            <Switch checked={proxied} onCheckedChange={setProxied} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => { void handleProvision() }} disabled={pending}>
            {pending ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Plus className="mr-1.5 size-3.5" />}
            Provision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
