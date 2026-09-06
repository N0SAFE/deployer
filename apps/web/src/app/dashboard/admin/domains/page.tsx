'use client'

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useState, useMemo, useEffect, useCallback } from 'react'
import { useForm } from '@tanstack/react-form'
import { useProjectDomains, useAddProjectDomain, useRemoveProjectDomain, useVerifyProjectDomain } from '@/domains/domain/hooks'
import { useDNSProviders, useCloudflareZones, useCloudflareCreateRecord } from '@/domains/dns-providers/hooks'
import { useProjectList } from '@/domains/project/hooks'
import { useDomainReachabilityCheck, useGetPublicIp, useNodeNetworkConfig, useCheckDomainGate, usePublicAccessPointLive } from '@/domains/reachability/hooks'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
import { Field, FieldLabel, FieldDescription } from '@repo/ui/components/shadcn/field'
import { Siren, Plus, Trash2, Globe, CheckCircle2, Clock, XCircle, RefreshCw, Copy, Building2, Network, Cloud, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod/v4'

const METHOD_LABELS: Record<string, string> = {
  txt_record: 'TXT Record',
  cname_record: 'CNAME Record',
}

/** Per-DNS-provider config fields — shown dynamically based on selected provider type */
const DNS_PROVIDER_CONFIG_FIELDS: Record<string, Array<{
  key: string
  label: string
  description: string
  type: 'text' | 'select' | 'boolean'
  required: boolean
  placeholder?: string
  options?: { label: string; value: string }[]
}>> = {
  cloudflare: [
    { key: 'zoneId', label: 'Zone ID', description: 'Cloudflare zone ID. Auto-detected if left empty.', type: 'text', required: false, placeholder: 'Auto-detect' },
    { key: 'recordType', label: 'Verification Record Type', description: 'DNS record type for domain verification.', type: 'select', required: true, options: [{ label: 'TXT Record', value: 'txt_record' }, { label: 'CNAME Record', value: 'cname_record' }] },
    { key: 'autoDns', label: 'Auto-create DNS record', description: 'Let the provider automatically create the verification record.', type: 'boolean', required: false },
  ],
  route53: [
    { key: 'hostedZoneId', label: 'Hosted Zone ID', description: 'Route53 hosted zone ID for the domain.', type: 'text', required: true, placeholder: 'Z0123456789ABCDEF' },
    { key: 'region', label: 'AWS Region', description: 'AWS region where the zone is hosted.', type: 'text', required: false, placeholder: 'us-east-1' },
  ],
  'google-dns': [
    { key: 'managedZone', label: 'Managed Zone Name', description: 'Google Cloud DNS managed zone name.', type: 'text', required: true, placeholder: 'my-zone' },
    { key: 'projectId', label: 'GCP Project ID', description: 'Google Cloud project ID.', type: 'text', required: true, placeholder: 'my-project' },
  ],
}

type DomainRow = {
  id: string
  domain: string
  verificationStatus: string
  verificationMethod: string
  verificationToken: string
  verifiedAt: string | null
  reachable?: boolean | null
  reachableChecked?: boolean
  reachableLoading?: boolean
}

export default function AdminDomainsPage() {
  // Mesh-wide projects — pick one to manage its domains.
  const { data: projectsData } = useProjectList({ query: { limit: 100, offset: 0 } })
  const projects = useMemo(() => (projectsData?.data ?? []) as Array<{ id: string; name?: string }>, [projectsData])
  const [projectId, setProjectId] = useState<string>('')

  const { data: domainsRaw, isLoading, error, refetch } = useProjectDomains(projectId)
  const domains = (domainsRaw ?? []) as Array<{
    id: string
    domain: string
    verificationStatus: string
    verificationMethod: string
    verificationToken: string
    verifiedAt: string | null
  }>
  const addDomain = useAddProjectDomain()
  const deleteDomain = useRemoveProjectDomain()
  const verifyDomain = useVerifyProjectDomain()
  const domainReachCheck = useDomainReachabilityCheck()
  const { data: publicIpData } = useGetPublicIp()
  const { data: nodeNetworkData } = useNodeNetworkConfig()
  const { data: domainGateData } = useCheckDomainGate()
  // LIVE public access point (SSE): keeps the node's reachability on screen.
  const accessPoint = usePublicAccessPointLive()
  const nodeNetwork = nodeNetworkData as { publicAddress: string | null; tunnel: { enabled: boolean; providerId: string | null } } | undefined
  const domainGate = domainGateData as { allowed: boolean; reason: string | null } | undefined
  // Expected IP for reachability checks: prefer the LIVE access point address
  // (IP kind), else the configured node address, else auto-detected.
  const publicIp = accessPoint.state?.kind === 'ip' && accessPoint.state.address
    ? accessPoint.state.address
    : (nodeNetwork?.publicAddress ?? publicIpData?.ip ?? null)
  const { data: providersData } = useDNSProviders()
  const providers = providersData?.providers ?? []

  const [addOpen, setAddOpen] = useState(false)
  const [addMode, setAddMode] = useState<'provider' | 'manual'>('manual')
  const [selectedProviderTab, setSelectedProviderTab] = useState('manual')

  // Domain reachability states — per-domain cache
  const [reachabilityMap, setReachabilityMap] = useState<Record<string, { reachable: boolean | null; loading: boolean }>>({})

  // Auto-run reachability checks when domains load
  const runReachabilityCheck = useCallback(async (domain: string, domainId: string) => {
    setReachabilityMap((prev) => ({ ...prev, [domainId]: { reachable: null, loading: true } }))
    try {
      const result = await domainReachCheck.mutateAsync({ domain, expectedIp: publicIp ?? undefined })
      const data = result as unknown as {
        resolvedIps: string[]
        httpReachable: boolean
        dnsMatch: boolean | null
        error?: string
      }
      const isReachable = data.dnsMatch === true && data.httpReachable
      setReachabilityMap((prev) => ({ ...prev, [domainId]: { reachable: isReachable, loading: false } }))
    } catch {
      setReachabilityMap((prev) => ({ ...prev, [domainId]: { reachable: false, loading: false } }))
    }
  }, [domainReachCheck, publicIp])

  useEffect(() => {
    if (!domains || domains.length === 0) return
    for (const d of domains) {
      const id = d.id
      if (!reachabilityMap[id] || reachabilityMap[id].reachable === undefined) {
        runReachabilityCheck(d.domain, id)
      }
    }
  }, [domains, runReachabilityCheck])

  // Provider form — dynamic: fields change based on selected provider type
  const [selectedProviderType, setSelectedProviderType] = useState<string | null>(null)
  const [selectedProviderAccount, setSelectedProviderAccount] = useState<string>('')
  const { data: zonesData } = useCloudflareZones(selectedProviderAccount)
  const zones = zonesData?.zones ?? []
  const zonesError = zonesData?.error ?? null
  const createCloudflareRecord = useCloudflareCreateRecord()

  const providerForm = useForm({
    defaultValues: { domain: '', providerType: '', providerId: '', zoneId: '', recordType: 'txt_record', hostedZoneId: '', region: '', managedZone: '', projectId: '', autoDns: true } as Record<string, unknown>,
    onSubmit: async ({ value }) => {
      if (!projectId) { toast.error('Select a project first'); return }
      if (!(value.domain as string)?.trim() || !value.providerType) { toast.error('Domain and provider type are required'); return }
      const domain = (value.domain as string).trim()
      try {
        const result = await addDomain.mutateAsync({ params: { projectId }, body: { domain, verificationMethod: (value.recordType as 'txt_record' | 'cname_record') ?? 'txt_record' } }) as unknown as {
          verificationInstructions?: { recordName?: string; recordValue?: string }
        }

        // Auto-create the verification DNS record on the provider's zone.
        let autoDnsCreated = false
        const providerId = selectedProviderAccount
        const zoneId = value.zoneId as string | undefined
        const recordName = result?.verificationInstructions?.recordName
        const recordValue = result?.verificationInstructions?.recordValue
        if (value.autoDns === true && providerId && zoneId && recordName && recordValue) {
          try {
            await createCloudflareRecord.mutateAsync({
              params: { providerId, zoneId },
              body: { type: 'TXT', name: recordName, content: recordValue },
            })
            autoDnsCreated = true
          } catch (err) {
            toast.warning('Domain added, but auto DNS record creation failed', {
              description: isDefinedORPCError(err) ? getErrorMessage(err, 'Create the TXT record manually to verify.') : UNKNOWN_ORPC_ERROR_MESSAGE,
            })
          }
        }

        toast.success(autoDnsCreated ? 'Domain added — DNS record created, verifying' : 'Domain added')
        setAddOpen(false)
        providerForm.reset()
        setSelectedProviderType(null)
        setSelectedProviderAccount('')
      } catch (err) {
        toast.error('Failed to add domain', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
      }
    },
  })

  const domainRows = domains

  // Manual form
  const manualForm = useForm({
    defaultValues: { domain: '', method: 'txt_record' as 'txt_record' | 'cname_record' },
    onSubmit: async ({ value }) => {
      if (!projectId) { toast.error('Select a project first'); return }
      if (!value.domain.trim()) { toast.error('Domain name is required'); return }
      try {
        await addDomain.mutateAsync({
          params: { projectId },
          body: { domain: value.domain.trim(), verificationMethod: value.method },
        })
        toast.success('Domain added — add the DNS record and verify')
        setAddOpen(false)
        manualForm.reset()
      } catch (err) {
        toast.error('Failed to add domain', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
      }
    },
  })

  // DNS Check dialog state
  const [dnsCheckResult, setDnsCheckResult] = useState<{
    domain: string
    resolvedIps: string[]
    httpReachable: boolean
    httpStatusCode?: number
    dnsMatch: boolean | null
    expectedIp?: string
    error?: string
  } | null>(null)
  const [dnsCheckOpen, setDnsCheckOpen] = useState(false)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState('')

  const handleDelete = async () => {
    if (!deleteId || !projectId) return
    try {
      await deleteDomain.mutateAsync({ params: { projectId, domainId: deleteId } })
      toast.success('Domain removed')
      setDeleteOpen(false)
      setDeleteId(null)
    } catch (err) {
      toast.error('Failed to remove', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    }
  }

  const handleVerify = async (id: string) => {
    if (!projectId) return
    try {
      const result = await verifyDomain.mutateAsync({ params: { projectId, domainId: id }, body: {} }) as unknown as { status: string }
      const status = result.status
      if (status === 'verified') {
        toast.success('Domain verified!')
      } else {
        toast.info('Verification pending', { description: 'DNS records may still be propagating.' })
      }
      await refetch()
    } catch (err) {
      toast.error('Verification failed', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'DNS record not found') : UNKNOWN_ORPC_ERROR_MESSAGE })
    }
  }

  const handleDnsCheck = async (domain: string) => {
    try {
      const result = await domainReachCheck.mutateAsync({ domain, expectedIp: publicIp ?? undefined })
      const data = result as unknown as {
        domain: string
        resolvedIps: string[]
        httpReachable: boolean
        httpStatusCode?: number
        dnsMatch: boolean | null
        error?: string
      }
      setDnsCheckResult({ ...data, expectedIp: publicIp ?? undefined })
      setDnsCheckOpen(true)
      if (data.dnsMatch === true && data.httpReachable) {
        toast.success(`${domain} resolves correctly`)
      } else if (data.dnsMatch === false) {
        toast.warning(`DNS mismatch: resolved to ${data.resolvedIps.join(', ')}, expected ${publicIp ?? 'unknown'}`)
      }
    } catch (err) {
      toast.error('DNS check failed', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    }
  }

  const getStatusBadge = (v: string) => {
    switch (v) {
      case 'verified': return { variant: 'default' as const, icon: CheckCircle2, label: 'Verified' }
      case 'pending': return { variant: 'secondary' as const, icon: Clock, label: 'Pending' }
      case 'failed': return { variant: 'destructive' as const, icon: XCircle, label: 'Failed' }
      default: return { variant: 'outline' as const, icon: Clock, label: v }
    }
  }

  const getReachabilityBadge = (domainId: string) => {
    const r = reachabilityMap[domainId]
    if (!r || r.loading) return { variant: 'outline' as const, icon: Loader2, label: 'Checking...' }
    if (r.reachable === true) return { variant: 'default' as const, icon: CheckCircle2, label: 'Reachable' }
    if (r.reachable === false) return { variant: 'destructive' as const, icon: XCircle, label: 'Unreachable' }
    return { variant: 'outline' as const, icon: Clock, label: 'Unknown' }
  }

  if (isLoading) return <div className="space-y-6"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full rounded-xl" /></div>
  if (error) return <Alert variant="destructive"><Siren className="size-4" /><AlertTitle>Failed to load domains</AlertTitle><AlertDescription>{isDefinedORPCError(error) ? getErrorMessage(error) : 'An error occurred'}</AlertDescription></Alert>

  if (projects.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Building2 className="mb-4 size-12 text-muted-foreground/40" />
          <p className="text-lg font-medium">No projects yet</p>
          <p className="text-sm text-muted-foreground">Create a project first — domains belong to projects.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Globe className="size-6 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Domains</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Manage domains for the selected project. Add via a DNS provider for automatic setup or manually, then verify before use.
          </p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)} disabled={domainGate?.allowed === false}>
          <Plus className="mr-2 size-4" />Add Domain
        </Button>
      </div>

      {/* Domain gate banner — global IP / tunnel prerequisite */}
      {domainGate?.allowed === false && (
        <Alert variant="destructive">
          <Siren className="size-4" />
          <AlertTitle>Cannot create domains yet</AlertTitle>
          <AlertDescription>
            {domainGate.reason ?? 'No public IP or hostname configured and tunnel mode is off.'}{' '}
            Set a globally reachable public IP in <span className="font-medium">System → Node Network &amp; Reachability</span>,
            or enable Cloudflare Tunnel mode on the Cloudflare provider page.
          </AlertDescription>
        </Alert>
      )}

      {/* Add Domain Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Add Domain</DialogTitle><DialogDescription>Choose how to add and verify the domain.</DialogDescription></DialogHeader>
          <Tabs value={selectedProviderTab} onValueChange={(v) => setSelectedProviderTab(v)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="provider">Via DNS Provider</TabsTrigger>
              <TabsTrigger value="manual">Manual</TabsTrigger>
            </TabsList>

            <TabsContent value="provider" className="space-y-4 pt-4">
              <p className="text-sm text-muted-foreground">
                Select a DNS provider type and configure the verification record.
              </p>

              {/* Domain field */}
              <providerForm.Field name="domain">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="prov-domain">Domain</FieldLabel>
                    <Input id="prov-domain" value={field.state.value as string} onChange={(e) => field.handleChange(e.target.value)} placeholder="example.com" />
                  </Field>
                )}
              </providerForm.Field>

              {/* Provider type selector */}
              <providerForm.Field name="providerType">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="provider-type">DNS Provider Type</FieldLabel>
                    <Select value={field.state.value as string} onValueChange={(v) => { field.handleChange(v); setSelectedProviderType(v) }}>
                      <SelectTrigger id="provider-type"><SelectValue placeholder="Select provider type" /></SelectTrigger>
                      <SelectContent>
                        {Object.keys(DNS_PROVIDER_CONFIG_FIELDS).map((type) => (
                          <SelectItem key={type} value={type}>
                            {type === 'cloudflare' ? 'Cloudflare' : type === 'route53' ? 'AWS Route53' : type === 'google-dns' ? 'Google Cloud DNS' : type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </providerForm.Field>

              {/* Dynamic fields based on selected provider type */}
              {selectedProviderType && DNS_PROVIDER_CONFIG_FIELDS[selectedProviderType]?.map((configField) => (
                <providerForm.Field key={configField.key} name={configField.key}>
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor={configField.key}>{configField.label}{configField.required ? ' *' : ''}</FieldLabel>
                      <FieldDescription>{configField.description}</FieldDescription>
                      {configField.type === 'select' ? (
                        <Select value={field.state.value as string} onValueChange={(v) => field.handleChange(v)}>
                          <SelectTrigger id={configField.key}><SelectValue placeholder={(configField.placeholder as string) ?? 'Select...'} /></SelectTrigger>
                          <SelectContent>
                            {(configField.options ?? []).map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : configField.type === 'boolean' ? (
                        <div className="flex items-center gap-2 pt-1">
                          <input type="checkbox" id={configField.key} checked={!!field.state.value} onChange={(e) => field.handleChange(e.target.checked)} className="size-4 rounded border-border" />
                          <Label htmlFor={configField.key}>{configField.label}</Label>
                        </div>
                      ) : (
                        <Input id={configField.key} value={field.state.value as string} onChange={(e) => field.handleChange(e.target.value)} placeholder={configField.placeholder as string | undefined} />
                      )}
                    </Field>
                  )}
                </providerForm.Field>
              ))}

              {/* Connected provider selector (API key account) */}
              {providers.length > 0 && (
                <providerForm.Field name="providerId">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="prov-account">Connected Account</FieldLabel>
                      <FieldDescription>Select which API key account to use for this domain.</FieldDescription>
                      <Select value={field.state.value as string} onValueChange={(v) => { field.handleChange(v); setSelectedProviderAccount(v) }}>
                        <SelectTrigger id="prov-account"><SelectValue placeholder="Select account" /></SelectTrigger>
                        <SelectContent>
                          {providers.map((p: { id: string; name: string }) => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                </providerForm.Field>
              )}

              {/* Zone picker — Cloudflare accounts enumerate the zones their token can edit */}
              {selectedProviderType === 'cloudflare' && selectedProviderAccount && (
                <providerForm.Field name="zoneId">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="prov-zone">Zone</FieldLabel>
                      <FieldDescription>
                        Zones this account&apos;s token can manage. Picking one fills the domain —
                        you can then prefix it to register a subdomain (e.g. <code>app.example.com</code>).
                      </FieldDescription>
                      <Select
                        value={field.state.value as string}
                        onValueChange={(v) => {
                          field.handleChange(v)
                          const zone = zones.find((z: { id: string }) => z.id === v)
                          if (zone) providerForm.setFieldValue('domain', zone.name)
                        }}
                      >
                        <SelectTrigger id="prov-zone"><SelectValue placeholder="Select zone" /></SelectTrigger>
                        <SelectContent>
                          {zonesError && <SelectItem value="__none__" disabled>{zonesError}</SelectItem>}
                          {!zonesError && zones.length === 0 && <SelectItem value="__none__" disabled>No zones — check token permissions</SelectItem>}
                          {zones.map((z: { id: string; name: string; status: string }) => (
                            <SelectItem key={z.id} value={z.id}>
                              {z.name} ({z.status})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {zonesError && (
                        <p className="text-xs text-destructive pt-1">{zonesError}</p>
                      )}
                      <p className="text-xs text-muted-foreground pt-1">
                        Register the zone itself or a subdomain of it. The provider account will be able to edit DNS records for this domain.
                      </p>
                    </Field>
                  )}
                </providerForm.Field>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button onClick={providerForm.handleSubmit} disabled={addDomain.isPending}>
                  {addDomain.isPending ? 'Adding...' : 'Add Domain'}
                </Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent value="manual" className="space-y-4 pt-4">
              <manualForm.Field name="domain">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="manual-domain">Domain</FieldLabel>
                    <FieldDescription>Enter the domain name you want to verify ownership of.</FieldDescription>
                    <Input id="manual-domain" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="example.com" />
                  </Field>
                )}
              </manualForm.Field>
              <manualForm.Field name="method">
                {(field) => (
                  <div className="grid gap-2">
                    <Label htmlFor="manual-method">Verification Method</Label>
                    <Select value={field.state.value} onValueChange={(v) => field.handleChange(v as 'txt_record' | 'cname_record')}>
                      <SelectTrigger id="manual-method"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="txt_record">TXT Record</SelectItem>
                        <SelectItem value="cname_record">CNAME Record</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      TXT records are recommended. Add a TXT record to <code className="text-xs">_deployer-verify.yourdomain.com</code>.
                    </p>
                  </div>
                )}
              </manualForm.Field>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
                <manualForm.Subscribe selector={(s) => s.canSubmit}>
                  {(canSubmit) => (
                    <Button onClick={manualForm.handleSubmit} disabled={!canSubmit || addDomain.isPending}>
                      {addDomain.isPending ? 'Adding...' : 'Add Domain'}
                    </Button>
                  )}
                </manualForm.Subscribe>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {(domainRows.length === 0) ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Globe className="mb-4 size-12 text-muted-foreground/40" />
            <p className="text-lg font-medium">No domains configured</p>
            <p className="text-sm text-muted-foreground">Add a domain to enable project domain assignment and service URL mapping.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader><CardTitle>Project Domains</CardTitle><CardDescription>{domainRows.length} domain{domainRows.length !== 1 ? 's' : ''} — reachability checks run automatically on load</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reachability</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>DNS Instruction</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {domainRows.map((row, i) => {
                  const domainId = row.id
                  const domain = row.domain
                  const verStatus = row.verificationStatus
                  const verMethod = row.verificationMethod
                  const token = row.verificationToken
                  const recordName = verMethod === 'txt_record' ? `_deployer-verify.${domain}` : `_deployer-verify`
                  const badge = getStatusBadge(verStatus)
                  const StatusIcon = badge.icon
                  const reachBadge = getReachabilityBadge(domainId)
                  const ReachIcon = reachBadge.icon
                  return (
                    <TableRow key={domainId || i}>
                      <TableCell className="font-medium">{domain}</TableCell>
                      <TableCell>
                        <Badge variant={badge.variant} className="gap-1">
                          <StatusIcon className="size-3" />
                          {badge.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={reachBadge.variant} className="gap-1">
                          <ReachIcon className={`size-3 ${reachBadge.label === 'Checking...' ? 'animate-spin' : ''}`} />
                          {reachBadge.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{METHOD_LABELS[verMethod] ?? verMethod}</TableCell>
                      <TableCell className="max-w-xs">
                        {verStatus !== 'verified' && token ? (
                          <div className="space-y-1">
                            <p className="text-xs font-mono text-muted-foreground break-all">{recordName}</p>
                            <div className="flex items-center gap-1">
                              <code className="text-xs bg-muted px-1.5 py-0.5 rounded break-all">{token}</code>
                              <Button variant="ghost" size="icon" className="size-5 shrink-0" onClick={() => { navigator.clipboard.writeText(token); toast.success('Copied!') }}>
                                <Copy className="size-3" />
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {verStatus !== 'verified' && (
                            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleVerify(domainId)} disabled={verifyDomain.isPending}>
                              <RefreshCw className="mr-1 size-3" />Verify
                            </Button>
                          )}
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleDnsCheck(domain)} disabled={domainReachCheck.isPending}>
                            <Network className="mr-1 size-3" />Reach
                          </Button>
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => runReachabilityCheck(domain, domainId)}>
                            <RefreshCw className={`size-3 ${reachabilityMap[domainId]?.loading ? 'animate-spin' : ''}`} />
                          </Button>
                          <Button variant="ghost" size="icon" className="size-7" onClick={() => { setDeleteId(domainId); setDeleteName(domain); setDeleteOpen(true) }}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Remove Domain</DialogTitle><DialogDescription>Are you sure? This will unlink the domain from all projects.</DialogDescription></DialogHeader>
          <p className="text-sm text-muted-foreground">Remove <strong>{deleteName}</strong>?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteDomain.isPending}>{deleteDomain.isPending ? 'Removing...' : 'Remove'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DNS Check Result Dialog */}
      <Dialog open={dnsCheckOpen} onOpenChange={setDnsCheckOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>DNS Check: {dnsCheckResult?.domain ?? ''}</DialogTitle><DialogDescription>Domain resolution and reachability from public internet.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            {dnsCheckResult && <>
              <div className="flex items-center gap-2">
                <div className={`size-3 rounded-full ${dnsCheckResult.httpReachable ? 'bg-green-500' : dnsCheckResult.resolvedIps.length > 0 ? 'bg-yellow-500' : 'bg-red-500'}`} />
                <span className="font-medium">{dnsCheckResult.httpReachable ? 'Reachable' : dnsCheckResult.resolvedIps.length > 0 ? 'DNS OK but not reachable' : 'Not resolving'}</span>
                {dnsCheckResult.httpStatusCode && <Badge variant="outline">{dnsCheckResult.httpStatusCode}</Badge>}
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Resolved IPs</p>
                  <p className="font-mono text-xs">{dnsCheckResult.resolvedIps.join(', ') || 'None'}</p>
                </div>
                {dnsCheckResult.expectedIp && <div>
                  <p className="text-muted-foreground text-xs">Expected IP (API)</p>
                  <p className="font-mono text-xs">{dnsCheckResult.expectedIp}</p>
                </div>}
                {dnsCheckResult.dnsMatch !== null && <div>
                  <p className="text-muted-foreground text-xs">DNS Match</p>
                  <Badge variant={dnsCheckResult.dnsMatch ? 'default' : 'destructive'}>{dnsCheckResult.dnsMatch ? 'Match' : 'Mismatch'}</Badge>
                </div>}
              </div>
              {dnsCheckResult.error && <Alert variant="destructive"><Siren className="size-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{dnsCheckResult.error}</AlertDescription></Alert>}
            </>}
          </div>
          <DialogFooter>
            <Button onClick={() => setDnsCheckOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
