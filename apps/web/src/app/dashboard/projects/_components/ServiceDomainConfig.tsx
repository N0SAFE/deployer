'use client'

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useState, useMemo, useCallback } from 'react'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { CheckCircle2, Globe, Loader2, Plus, ShieldCheck, Trash2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@repo/ui/lib/utils'
import {
  useAddServiceDomain,
  useCheckSubdomainAvailability,
  useProjectDomains,
  useRemoveServiceDomain,
  useServiceDomains,
} from '@/domains/domain/hooks'

/* ─── Types ────────────────────────────────────────────────────────────── */

/** A single domain binding a user is configuring (wizard / pre-persist). */
export interface ServiceDomainEntry {
  projectDomainId: string
  subdomain: string | null
  basePath: string | null
  isPrimary: boolean
  sslEnabled: boolean
}

interface ServiceDomainConfigProps {
  projectId: string
  /** When provided, the component manages real mappings via the API (connected mode). */
  serviceId?: string
  /** Controlled mode (e.g. creation wizard): entries are managed by the parent. */
  value?: ServiceDomainEntry[]
  onChange?: (entries: ServiceDomainEntry[]) => void
  disabled?: boolean
}

interface ProjectDomainRow {
  id: string
  domain: string
  verificationStatus?: string
  allowedSubdomains: string[]
  isPrimary: boolean
}

/* ─── Helpers ──────────────────────────────────────────────────────────── */

export function resolveFullUrl(domain: string, subdomain: string | null, basePath: string | null): string {
  const host = subdomain && subdomain.trim() ? `${subdomain.trim()}.${domain}` : domain
  const path = basePath && basePath.trim() ? `/${basePath.replace(/^\/+/, '').replace(/\/+$/, '')}` : ''
  return `https://${host}${path}`
}

function sanitizeSubdomain(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
}

function sanitizeBasePath(input: string): string {
  return input
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/')
    .slice(0, 255)
}

/* ─── Entry row ────────────────────────────────────────────────────────── */

function EntryRow({
  domainName,
  subdomain,
  basePath,
  isPrimary,
  sslEnabled,
  sslProvider,
  onRemove,
  disabled,
}: {
  domainName: string
  subdomain: string | null
  basePath: string | null
  isPrimary: boolean
  sslEnabled: boolean
  sslProvider?: string | null
  onRemove: () => void
  disabled?: boolean
}) {
  const url = resolveFullUrl(domainName, subdomain, basePath)
  const providerLabel = sslEnabled
    ? sslProvider === 'custom' ? 'Custom cert'
      : sslProvider === 'none' ? 'No SSL'
      : 'Let\'s Encrypt'
    : 'No SSL'
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-sm text-foreground">{url}</code>
          {isPrimary && <Badge variant="default">Primary</Badge>}
          <Badge variant={sslEnabled ? 'outline' : 'secondary'} className="gap-1">
            <ShieldCheck className="size-3" /> {providerLabel}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {subdomain ? `Subdomain "${subdomain}" of ${domainName}` : `Root of ${domainName}`}
          {basePath ? ` · path /${basePath}` : ''}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        onClick={onRemove}
        disabled={disabled}
        title="Remove domain"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  )
}

/* ─── Add-entry form ───────────────────────────────────────────────────── */

function AddEntryForm({
  projectDomains,
  existingProjectDomainIds,
  onAdd,
  disabled,
}: {
  projectDomains: ProjectDomainRow[]
  existingProjectDomainIds: Set<string>
  onAdd: (entry: ServiceDomainEntry) => void
  disabled?: boolean
}) {
  const [projectDomainId, setProjectDomainId] = useState<string>('')
  const [subdomain, setSubdomain] = useState<string>('')
  const [basePath, setBasePath] = useState<string>('')
  const [isPrimary, setIsPrimary] = useState(false)
  const [sslEnabled, setSslEnabled] = useState(true)

  const checkAvailability = useCheckSubdomainAvailability()
  const [checking, setChecking] = useState(false)

  const selected = useMemo(
    () => projectDomains.find((d) => d.id === projectDomainId),
    [projectDomains, projectDomainId],
  )

  const available = useMemo(
    () => projectDomains.filter((d) => !existingProjectDomainIds.has(d.id)),
    [projectDomains, existingProjectDomainIds],
  )

  const subdomainOptions = useMemo(() => {
    if (!selected) return []
    const allowed = selected.allowedSubdomains ?? []
    if (allowed.includes('*')) return [] // any subdomain allowed
    return allowed
  }, [selected])

  const domainName = selected?.domain ?? ''

  const reset = () => {
    setProjectDomainId('')
    setSubdomain('')
    setBasePath('')
    setIsPrimary(false)
    setSslEnabled(true)
  }

  const handleAdd = useCallback(async () => {
    if (!selected) {
      toast.error('Select a domain first')
      return
    }
    const sub = subdomain.trim() ? sanitizeSubdomain(subdomain) : null
    const path = basePath.trim() ? sanitizeBasePath(basePath) : null

    if (subdomain.trim() && !sub) {
      toast.error('Subdomain contains only invalid characters')
      return
    }
    // Constraint: if the project domain restricts subdomains, enforce them.
    if (sub && subdomainOptions.length > 0 && !subdomainOptions.includes(sub)) {
      toast.error(`Subdomain must be one of: ${subdomainOptions.join(', ')}`)
      return
    }

    // Server-side conflict check (best-effort; failures don't block).
    setChecking(true)
    try {
      const result = await checkAvailability.mutateAsync({
        projectDomainId: selected.id,
        subdomain: sub,
        basePath: path,
      })
      const data = result as unknown as { available?: boolean; conflicts?: Array<{ fullUrl: string }> }
      if (data.available === false) {
        const conflictUrls = (data.conflicts ?? []).map((c) => c.fullUrl).join(', ')
        toast.error(`Domain already in use${conflictUrls ? ` by ${conflictUrls}` : ''}`)
        return
      }
    } catch {
      // Availability check is advisory — proceed; the server will reject duplicates.
    } finally {
      setChecking(false)
    }

    onAdd({ projectDomainId: selected.id, subdomain: sub, basePath: path, isPrimary, sslEnabled })
    reset()
  }, [selected, subdomain, subdomainOptions, basePath, isPrimary, sslEnabled, checkAvailability, onAdd])

  const previewUrl = selected ? resolveFullUrl(domainName, subdomain.trim() ? sanitizeSubdomain(subdomain) : null, basePath.trim() ? sanitizeBasePath(basePath) : null) : null

  if (available.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No additional configured domains available for this service.
      </p>
    )
  }

  return (
    <div className="space-y-4 rounded-lg border border-dashed border-border p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Domain</Label>
          <Select value={projectDomainId} onValueChange={(v) => { setProjectDomainId(v); setSubdomain('') }}>
            <SelectTrigger><SelectValue placeholder="Select a configured domain" /></SelectTrigger>
            <SelectContent>
              {available.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.domain ?? d.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Subdomain</Label>
          {subdomainOptions.length > 0 ? (
            <Select value={subdomain} onValueChange={setSubdomain}>
              <SelectTrigger><SelectValue placeholder="Select subdomain" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Root (no subdomain)</SelectItem>
                {subdomainOptions.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value)}
                placeholder={domainName ? `subdomain of ${domainName}` : 'e.g. api'}
                className="font-mono"
                disabled={!selected}
              />
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => setSubdomain('')} disabled={!subdomain}>
                Root
              </Button>
            </div>
          )}
          {selected && !subdomain && <p className="text-xs text-muted-foreground">Leave empty to use the root domain.</p>}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Base path (optional)</Label>
          <Input
            value={basePath}
            onChange={(e) => setBasePath(e.target.value)}
            placeholder="/v1"
            className="font-mono"
            disabled={!selected}
          />
        </div>

        <div className="flex items-end gap-4">
          <div className="flex items-center gap-2">
            <Switch id="sd-ssl" checked={sslEnabled} onCheckedChange={setSslEnabled} disabled={!selected} />
            <Label htmlFor="sd-ssl" className="text-sm font-normal">SSL</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="sd-primary" checked={isPrimary} onCheckedChange={setIsPrimary} disabled={!selected} />
            <Label htmlFor="sd-primary" className="text-sm font-normal">Primary</Label>
          </div>
        </div>
      </div>

      {previewUrl && (
        <div className="flex items-center gap-2 rounded-md bg-primary/5 px-3 py-2 text-sm">
          <Globe className="size-4 text-primary" />
          <span className="text-muted-foreground">Will be served at</span>
          <code className="font-mono font-medium text-foreground">{previewUrl}</code>
        </div>
      )}

      <div className="flex justify-end">
        <Button size="sm" onClick={handleAdd} disabled={!selected || disabled || checking}>
          {checking ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Plus className="mr-1 size-4" />}
          Add domain
        </Button>
      </div>
    </div>
  )
}

/* ─── Main component ───────────────────────────────────────────────────── */

export function ServiceDomainConfig({ projectId, serviceId, value, onChange, disabled }: ServiceDomainConfigProps) {
  const { data: projectDomainsData, isLoading } = useProjectDomains(projectId)
  const { data: serviceDomainsData } = useServiceDomains(serviceId ?? '')
  const addServiceDomain = useAddServiceDomain()
  const removeServiceDomain = useRemoveServiceDomain()

  const isControlled = serviceId === undefined
  const projectDomains: ProjectDomainRow[] = (projectDomainsData ?? []) as ProjectDomainRow[]

  // Connected mode: existing mappings from the API.
  const connectedMappings = useMemo(() => {
    if (isControlled) return []
    return (serviceDomainsData ?? []) as Array<{
      id: string
      projectDomainId: string
      subdomain: string | null
      basePath: string | null
      isPrimary: boolean
      sslEnabled: boolean
      sslProvider?: string | null
      fullUrl: string
      domain?: string
    }>
  }, [isControlled, serviceDomainsData])

  const existingProjectDomainIds = useMemo(() => {
    const ids = new Set<string>()
    if (isControlled) {
      for (const e of value ?? []) ids.add(e.projectDomainId)
    } else {
      for (const m of connectedMappings) ids.add(m.projectDomainId)
    }
    return ids
  }, [isControlled, value, connectedMappings])

  const domainNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const d of projectDomains) {
      if (d.domain) map.set(d.id, d.domain)
    }
    return map
  }, [projectDomains])

  const handleRemoveControlled = (index: number) => {
    if (!onChange) return
    onChange((value ?? []).filter((_, i) => i !== index))
  }

  const handleAddControlled = (entry: ServiceDomainEntry) => {
    if (!onChange) return
    onChange([...(value ?? []), entry])
  }

  const handleAddConnected = async (entry: ServiceDomainEntry) => {
    if (!serviceId) return
    try {
      await addServiceDomain.mutateAsync({
        params: { serviceId },
        body: {
          projectDomainId: entry.projectDomainId,
          subdomain: entry.subdomain,
          basePath: entry.basePath,
          isPrimary: entry.isPrimary,
          sslEnabled: entry.sslEnabled,
          sslProvider: 'letsencrypt',
        },
      })
      toast.success('Domain attached to service')
    } catch (err) {
      toast.error('Failed to attach domain', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    }
  }

  const handleRemoveConnected = async (mappingId: string) => {
    if (!serviceId) return
    try {
      await removeServiceDomain.mutateAsync({ params: { serviceId, mappingId } })
      toast.success('Domain removed from service')
    } catch (err) {
      toast.error('Failed to remove domain', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    )
  }

  const entries = isControlled
    ? (value ?? []).map((e, i) => ({
        key: `entry-${i}`,
        domainName: domainNameById.get(e.projectDomainId) ?? 'unknown domain',
        subdomain: e.subdomain,
        basePath: e.basePath,
        isPrimary: e.isPrimary,
        sslEnabled: e.sslEnabled,
        sslProvider: 'letsencrypt',
        remove: () => handleRemoveControlled(i),
      }))
    : connectedMappings.map((m) => ({
        key: m.id,
        domainName: m.domain ?? domainNameById.get(m.projectDomainId) ?? 'unknown domain',
        subdomain: m.subdomain,
        basePath: m.basePath,
        isPrimary: m.isPrimary,
        sslEnabled: m.sslEnabled,
        sslProvider: m.sslProvider ?? 'letsencrypt',
        remove: () => handleRemoveConnected(m.id),
      }))

  return (
    <div className="space-y-4">
      {entries.length === 0 && (
        <Alert>
          <Globe className="size-4" />
          <AlertTitle>No domains configured</AlertTitle>
          <AlertDescription>
            Attach a configured domain below to expose this service on a public URL. Subdomains are
            constrained by the domain&apos;s configuration.
          </AlertDescription>
        </Alert>
      )}

      {entries.length > 0 && (
        <div className="space-y-2">
          {entries.map((e) => (
            <EntryRow
              key={e.key}
              domainName={e.domainName}
              subdomain={e.subdomain}
              basePath={e.basePath}
              isPrimary={e.isPrimary}
              sslEnabled={e.sslEnabled}
              sslProvider={e.sslProvider}
              onRemove={e.remove}
              disabled={disabled}
            />
          ))}
        </div>
      )}

      <AddEntryForm
        projectDomains={projectDomains}
        existingProjectDomainIds={existingProjectDomainIds}
        onAdd={isControlled ? handleAddControlled : handleAddConnected}
        disabled={disabled}
      />
    </div>
  )
}
