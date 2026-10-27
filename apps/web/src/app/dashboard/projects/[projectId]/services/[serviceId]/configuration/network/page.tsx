'use client'

import type { RouteVisibility } from '@deployer/contracts-entities/entities/ingress/index'
import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useServiceNetwork, useUpdateServiceNetwork } from '@/domains/service/hooks'
import { useDNSProviders, useCloudflareZones } from '@/domains/dns-providers/hooks'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Label } from '@deployer/ui/components/shadcn/label'
import { Switch } from '@deployer/ui/components/shadcn/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deployer/ui/components/shadcn/select'
import { Save, Network, Lock, Plus, Cloud, ShieldCheck, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { PageSkeleton } from '@/components/dashboard'
import { AuthDashboardNetworkDns, AuthDashboardNetworkIngress } from '@/routes'
import { ServiceConfigSubNav } from '../../_components/service-config-subnav'
import { ServiceDomainConfig } from '@/app/dashboard/projects/_components/ServiceDomainConfig'
import { AutocompleteField } from '@/app/dashboard/projects/_components/steps/autocomplete-field'
import { InlineError } from '@/app/dashboard/projects/_components/workload/WorkloadStates'
import { DnsRecordsCard } from '@/app/dashboard/projects/_components/service-network/DnsRecordsCard'
import { RECORD_TYPES, isRecordType, type RecordType } from '@/app/dashboard/projects/_components/service-network/ProvisionRecordDialog'

type NetworkView = NonNullable<ReturnType<typeof useServiceNetwork>['data']>

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
  const { projectId, serviceId } = useParams<{ projectId: string; serviceId: string }>()
  const query = useServiceNetwork(serviceId)

  if (query.isLoading) return <PageSkeleton blocks={3} withStrip={false} label="Loading network configuration" />
  if (query.error) return <InlineError title="Could not load the network configuration" error={query.error} onRetry={() => { void query.refetch() }} />
  if (!query.data) return <InlineError title="Service not found" error={new Error('This service does not exist or was deleted.')} />
  // Keyed so the form seeds once per service; a refetch never overwrites what is being edited.
  return <NetworkForm key={serviceId} projectId={projectId} serviceId={serviceId} view={query.data} />
}

function NetworkForm({ projectId, serviceId, view }: { projectId: string; serviceId: string; view: NetworkView }) {
  const updateNetwork = useUpdateServiceNetwork()
  const { data: providersData } = useDNSProviders()

  const providers = useMemo(() => (providersData?.providers ?? []).filter((p) => p.isActive), [providersData])

  const network = view.network
  const resolvedProviderId = view.dnsProviderId
  const resolvedZoneName = view.zoneName

  // Seed with the service's OWN overrides only. With no override the selects
  // show the "Inherit (project default)" marker, so state must be '' —
  // otherwise saving would pin the resolved value as an accidental override.
  // `proxied` defaults to false: `?? true` asserted a setting never made.
  const [providerId, setProviderId] = useState(network?.dnsProviderId ?? '')
  const [zoneId, setZoneId] = useState(network?.zoneId ?? '')
  const [zoneName, setZoneName] = useState(network?.zoneName ?? '')
  const [recordType, setRecordType] = useState<RecordType>(network?.recordType ?? 'CNAME')
  const [recordContent, setRecordContent] = useState(network?.recordContent ?? '')
  const [proxied, setProxied] = useState(network?.proxied ?? false)
  const [autoProvision, setAutoProvision] = useState(network?.autoProvision ?? false)
  const [visibility, setVisibility] = useState<RouteVisibility>(network?.visibility ?? 'public')
  const [tlsEnabled, setTlsEnabled] = useState(network?.tls.enabled === true)

  // Overrides are active when the service's OWN network config pins a provider/zone.
  const overridesProvider = Boolean(network?.dnsProviderId)
  const overridesZone = Boolean(network?.zoneId)

  // Zones for the currently-selected provider (override selection).
  const { data: zonesData, isLoading: zonesLoading } = useCloudflareZones(providerId || undefined)
  const zones = useMemo(() => zonesData?.zones ?? [], [zonesData])

  const records = view.records
  const projectDomains = view.projectDomains

  const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? id

  // "Inherit (project default)" marker — selecting it clears the override so
  // the service inherits the project-level provider/zone on save.
  const INHERIT = '__inherit__'

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
              <Select value={visibility} onValueChange={(v) => { setVisibility(v as RouteVisibility) }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public — also reachable from the internet</SelectItem>
                  <SelectItem value="private">Private — this machine and the mesh</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                Private: reachable from this machine and mesh members only. Public: also served on the public lane. Neither
                option publishes a host port. Stack-wide lanes are managed under Network → Ingress &amp; edge.
              </p>
            </div>
            <div className={`flex items-center justify-between rounded-lg border p-3 ${visibility === 'public' ? '' : 'opacity-50'}`}>
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium"><Lock className="size-3.5" /> TLS termination</p>
                <p className="text-sm text-muted-foreground">Terminate HTTPS at the edge. Public services only.</p>
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
                    {pd.isPrimary ? <Badge variant="secondary" className="text-xs">primary</Badge> : null}
                    <div className="ml-auto flex flex-wrap gap-1">
                      {pd.allowedSubdomains.map((s) => (
                        <Badge key={s} variant="outline" className="font-mono text-xs">{s}</Badge>
                      ))}
                    </div>
                  </div>
                  {pd.existingMappings.length > 0 ? (
                    <div className="mt-2 space-y-1 border-t pt-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Existing bindings</p>
                      {pd.existingMappings.map((m) => (
                        <div key={`${m.serviceId}-${m.fullUrl}`} className="flex items-center gap-2 text-xs">
                          <Badge variant="outline" className="text-xs">{m.serviceName}</Badge>
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
              {overridesProvider ? <Badge variant="secondary" className="text-xs">overriding project</Badge> : null}
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
              {overridesZone ? <Badge variant="secondary" className="text-xs">overriding project</Badge> : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <DnsRecordsCard serviceId={serviceId} zoneId={zoneId} zoneName={zoneName} records={records} />

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
              <Select value={recordType} onValueChange={(v) => { if (isRecordType(v)) setRecordType(v) }}>
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
                <p className="text-sm text-muted-foreground">Cloudflare orange-cloud on provisioned records.</p>
              </div>
              <Switch checked={proxied} onCheckedChange={setProxied} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Auto-provision DNS</p>
                <p className="text-sm text-muted-foreground">Create the record automatically when a binding is saved.</p>
              </div>
              <Switch checked={autoProvision} onCheckedChange={setAutoProvision} />
            </div>
          </div>

        </CardContent>
      </Card>

      <Card className="border-dashed border-border/60 bg-card/20">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <p className="max-w-2xl text-sm text-muted-foreground">
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
