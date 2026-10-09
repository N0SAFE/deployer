'use client'

import { useMemo, useState } from 'react'
import { Globe, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { useCheckSubdomainAvailability } from '@/domains/domain/hooks'
import { resolveFullUrl, sanitizeBasePath, sanitizeSubdomain, type ServiceDomainEntry } from './domain-url'

export interface ProjectDomainOption {
  id: string
  domain: string
  allowedSubdomains: readonly string[]
}

const ROOT = '__root__'

export function AddDomainEntryForm({
  projectDomains,
  existingProjectDomainIds,
  onAdd,
  disabled,
}: {
  projectDomains: readonly ProjectDomainOption[]
  existingProjectDomainIds: ReadonlySet<string>
  onAdd: (entry: ServiceDomainEntry) => void
  disabled?: boolean
}) {
  const [projectDomainId, setProjectDomainId] = useState('')
  const [subdomain, setSubdomain] = useState('')
  const [basePath, setBasePath] = useState('')
  const [isPrimary, setIsPrimary] = useState(false)
  const [sslEnabled, setSslEnabled] = useState(true)
  const [checking, setChecking] = useState(false)
  const checkAvailability = useCheckSubdomainAvailability()

  const selected = useMemo(() => projectDomains.find((d) => d.id === projectDomainId), [projectDomains, projectDomainId])
  const available = useMemo(() => projectDomains.filter((d) => !existingProjectDomainIds.has(d.id)), [projectDomains, existingProjectDomainIds])

  // A '*' entry means any subdomain is allowed → free text; otherwise a closed list.
  const subdomainOptions = useMemo(() => {
    const allowed = selected?.allowedSubdomains ?? []
    return allowed.includes('*') ? [] : allowed
  }, [selected])

  const domainName = selected?.domain ?? ''
  const cleanSub = subdomain.trim() ? sanitizeSubdomain(subdomain) : null
  const cleanPath = basePath.trim() ? sanitizeBasePath(basePath) : null
  const previewUrl = selected ? resolveFullUrl(domainName, cleanSub, cleanPath) : null

  const reset = () => {
    setProjectDomainId('')
    setSubdomain('')
    setBasePath('')
    setIsPrimary(false)
    setSslEnabled(true)
  }

  const handleAdd = async () => {
    if (!selected) { toast.error('Select a domain first'); return }
    if (subdomain.trim() && !cleanSub) { toast.error('Subdomain contains only invalid characters'); return }
    if (cleanSub && subdomainOptions.length > 0 && !subdomainOptions.includes(cleanSub)) {
      toast.error(`Subdomain must be one of: ${subdomainOptions.join(', ')}`)
      return
    }

    // Server-side conflict check (advisory: a failed check does not block, the server rejects duplicates).
    setChecking(true)
    try {
      const result = await checkAvailability.mutateAsync({ projectDomainId: selected.id, subdomain: cleanSub, basePath: cleanPath })
      if (!result.available) {
        const conflictUrls = result.conflicts.map((c) => c.fullUrl).join(', ')
        toast.error(`Domain already in use${conflictUrls ? ` by ${conflictUrls}` : ''}`)
        return
      }
    } catch {
      // advisory only
    } finally {
      setChecking(false)
    }

    onAdd({ projectDomainId: selected.id, subdomain: cleanSub, basePath: cleanPath, isPrimary, sslEnabled })
    reset()
  }

  if (available.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {projectDomains.length === 0
          ? 'This project has no domains yet. Add one on the project Domains page, then bind it here.'
          : 'Every domain of this project is already bound to this service.'}
      </p>
    )
  }

  return (
    <div className="space-y-4 rounded-lg border border-dashed border-border p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="sd-domain">Domain</Label>
          <Select value={projectDomainId} onValueChange={(v) => { setProjectDomainId(v); setSubdomain('') }}>
            <SelectTrigger id="sd-domain"><SelectValue placeholder="Select a project domain" /></SelectTrigger>
            <SelectContent>
              {available.map((d) => (<SelectItem key={d.id} value={d.id}>{d.domain}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="sd-sub">Subdomain</Label>
          {subdomainOptions.length > 0 ? (
            <Select value={subdomain === '' ? ROOT : subdomain} onValueChange={(v) => { setSubdomain(v === ROOT ? '' : v) }}>
              <SelectTrigger id="sd-sub"><SelectValue placeholder="Select subdomain" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ROOT}>Root (no subdomain)</SelectItem>
                {subdomainOptions.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
              </SelectContent>
            </Select>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                id="sd-sub"
                value={subdomain}
                onChange={(e) => { setSubdomain(e.target.value) }}
                placeholder={domainName ? `subdomain of ${domainName}` : 'e.g. api'}
                className="font-mono"
                disabled={!selected}
              />
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => { setSubdomain('') }} disabled={!subdomain}>Root</Button>
            </div>
          )}
          {selected && !subdomain ? <p className="text-sm text-muted-foreground">Leave empty to use the root domain.</p> : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="sd-path">Base path (optional)</Label>
          <Input id="sd-path" value={basePath} onChange={(e) => { setBasePath(e.target.value) }} placeholder="/v1" className="font-mono" disabled={!selected} />
        </div>
        <div className="flex flex-wrap items-end gap-4">
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

      {previewUrl ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-primary/5 px-3 py-2 text-sm">
          <Globe className="size-4 text-primary" aria-hidden />
          <span className="text-muted-foreground">Will be served at</span>
          <code className="break-all font-mono font-medium text-foreground">{previewUrl}</code>
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button size="sm" onClick={() => { void handleAdd() }} disabled={!selected || disabled === true || checking}>
          {checking ? <Loader2 className="mr-1 size-4 animate-spin motion-reduce:animate-none" /> : <Plus className="mr-1 size-4" />}
          Add domain
        </Button>
      </div>
    </div>
  )
}
