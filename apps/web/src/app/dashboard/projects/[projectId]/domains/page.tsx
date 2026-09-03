'use client'

import { isDefinedORPCError, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useForm } from '@tanstack/react-form'
import { useParams } from 'next/navigation'
import { useProject } from '@/domains/project/hooks'
import { useProjectDomains, useAddProjectDomain, useRemoveProjectDomain, useAvailableDomains } from '@/domains/domain/hooks'
import { useDomainReachabilityCheck } from '@/domains/reachability/hooks'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@repo/ui/components/shadcn/dialog'
import { Field, FieldLabel, FieldDescription } from '@repo/ui/components/shadcn/field'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Siren, Globe, Plus, Trash2, CheckCircle2, XCircle, Clock, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { formatDate, shortId } from '../_utils/helpers'
import { AuthDashboardAdminDomains } from '@/routes'
import { z } from 'zod/v4'

const addDomainSchema = z.object({
  domain: z.string().min(1, 'Domain is required').regex(
    /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i,
    'Invalid domain format',
  ),
  isPrimary: z.boolean().optional(),
  subdomains: z.string().optional(),
})

export default function ProjectDomainsPage() {
  const params = useParams<{ projectId: string }>()
  const projectId = params.projectId ?? ''

  const { data: projectData } = useProject(projectId)
  const { data: domainsData, isLoading, error } = useProjectDomains(projectId)
  const addDomain = useAddProjectDomain()
  const removeDomain = useRemoveProjectDomain()
  const domainReachCheck = useDomainReachabilityCheck()

  // Direct-domain model — this project's own verified domains.
  const { data: availableDomainsData } = useAvailableDomains(projectId)
  // listProjectDomains / getAvailableDomains contracts both output arrays
  const availableDomains = useMemo(() => availableDomainsData ?? [], [availableDomainsData])
  const domains = useMemo(() => domainsData ?? [], [domainsData])

  // Reachability state — per-domain cache
  const [reachabilityMap, setReachabilityMap] = useState<Record<string, { reachable: boolean | null; loading: boolean }>>({})

  const runReachCheck = useCallback(async (domain: string, domainId: string) => {
    setReachabilityMap((prev) => ({ ...prev, [domainId]: { reachable: null, loading: true } }))
    try {
      const data = await domainReachCheck.mutateAsync({ domain })
      setReachabilityMap((prev) => ({ ...prev, [domainId]: { reachable: data.dnsMatch === true && data.httpReachable, loading: false } }))
    } catch {
      setReachabilityMap((prev) => ({ ...prev, [domainId]: { reachable: false, loading: false } }))
    }
  }, [domainReachCheck])

  // Auto-check reachability when domains load, only for verified domains
  useEffect(() => {
    if (!domains || domains.length === 0) return
    for (const d of domains) {
      const row = d as Record<string, unknown>
      const id = row.id as string
      const domainName = row.domain as string ?? ''
      if (domainName && (!reachabilityMap[id] || reachabilityMap[id].reachable === undefined)) {
        runReachCheck(domainName, id)
      }
    }
  }, [domains, runReachCheck])

  const [addOpen, setAddOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [removeName, setRemoveName] = useState('')

  const addForm = useForm({
    defaultValues: { domain: '', isPrimary: false, subdomains: '' },
    onSubmit: async ({ value }) => {
      const parsed = addDomainSchema.safeParse(value)
      if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? 'Invalid input'); return }
      if (!parsed.data.domain) { toast.error('Please enter a domain'); return }
      try {
        const body = {
          domain: parsed.data.domain,
          allowedSubdomains: (parsed.data.subdomains ?? '').split(',').map((s) => s.trim()).filter(Boolean),
          isPrimary: parsed.data.isPrimary ?? false,
        }
        await addDomain.mutateAsync({ params: { projectId }, body })
        toast.success('Domain added')
        setAddOpen(false)
        addForm.reset()
      } catch (err) {
        const message = isDefinedORPCError(err) ? getErrorMessage(err, 'Failed to add domain') : 'Failed to add domain'
        toast.error(message)
      }
    },
  })

  const handleRemove = async () => {
    if (!removeId) return
    try {
      await removeDomain.mutateAsync({ params: { projectId, domainId: removeId } })
      toast.success('Domain removed'); setRemoveOpen(false); setRemoveId(null)
    } catch (err) {
      const message = isDefinedORPCError(err) ? getErrorMessage(err, 'Failed to remove domain') : 'Failed to remove domain'
      toast.error(message)
    }
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case 'verified': return <CheckCircle2 className="size-4 text-green-500" />
      case 'pending': return <Clock className="size-4 text-yellow-500" />
      default: return <XCircle className="size-4 text-red-500" />
    }
  }

  const getReachabilityBadge = (domainId: string, _domainName: string) => {
    const r = reachabilityMap[domainId]
    if (!r || r.loading) return { variant: 'outline' as const, icon: Loader2, label: 'Checking...' }
    if (r.reachable === true) return { variant: 'default' as const, icon: CheckCircle2, label: 'Reachable' }
    if (r.reachable === false) return { variant: 'destructive' as const, icon: XCircle, label: 'Unreachable' }
    return { variant: 'outline' as const, icon: Clock, label: 'Unknown' }
  }

  const getDomainName = (d: Record<string, unknown>): string => {
    return (d.domain as string) ?? (d.name as string) ?? '-'
  }

  const getDomainStatus = (d: Record<string, unknown>): string => {
    return (d.verificationStatus as string) ?? (d.status as string) ?? 'unknown'
  }

  const getDomainCreatedAt = (d: Record<string, unknown>): string => {
    return (d.createdAt as string) ?? (d.created_at as string) ?? ''
  }

  const getDomainId = (d: Record<string, unknown>): string => {
    return (d.id as string) ?? ''
  }

  if (isLoading) return <div className="space-y-6"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full rounded-xl" /></div>
  if (error) return <Alert variant="destructive"><Siren className="size-4" /><AlertTitle>Failed to load domains</AlertTitle><AlertDescription>{isDefinedORPCError(error) ? getErrorMessage(error) : 'An error occurred'}</AlertDescription></Alert>

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Domains</CardTitle>
            <CardDescription>Manage domains for {projectData?.name ?? 'this project'}. Reachability checked automatically.</CardDescription>
          </div>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-2 size-4" />Add Domain</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Add Domain</DialogTitle>
                <DialogDescription>
                  Enter the domain you want to attach to this project. After
                  adding it, follow the verification records shown, then use
                  the domain from this project's domain list.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <addForm.Field name="domain">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="domain">Domain</FieldLabel>
                      <FieldDescription>
                        Example: example.com or app.example.com
                      </FieldDescription>
                      <Input id="domain" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="example.com" />
                    </Field>
                  )}
                </addForm.Field>
                <addForm.Field name="isPrimary">
                  {(field) => (
                    <div className="flex items-center gap-2">
                      <Switch id="isPrimary" checked={field.state.value} onCheckedChange={(v) => field.handleChange(v)} />
                      <Label htmlFor="isPrimary">Set as primary domain</Label>
                    </div>
                  )}
                </addForm.Field>
                <addForm.Field name="subdomains">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="subdomains">Allowed Subdomains</FieldLabel>
                      <FieldDescription>Comma-separated list of allowed subdomains (e.g. www, api, admin). Leave empty to allow all.</FieldDescription>
                      <Input id="subdomains" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="www, api, admin" />
                    </Field>
                  )}
                </addForm.Field>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setAddOpen(false); addForm.reset() }}>Cancel</Button>
                <addForm.Subscribe selector={(s) => s.isSubmitting}>
                  {(isSubmitting) => (
                    <Button onClick={addForm.handleSubmit} disabled={isSubmitting || addDomain.isPending}>
                      {addDomain.isPending ? 'Adding...' : 'Add'}
                    </Button>
                  )}
                </addForm.Subscribe>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {domains.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Globe className="mb-4 size-12 text-muted-foreground/40" />
              <p className="text-lg font-medium">No domains configured</p>
              <p className="text-sm text-muted-foreground">Add a domain to get started.</p>
              <div className="mt-4">
                <AuthDashboardAdminDomains.Link className="text-sm text-primary underline inline-flex items-center gap-1">
                  Manage project domains <ExternalLink className="size-3" />
                </AuthDashboardAdminDomains.Link>
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reachability</TableHead>
                  <TableHead>Primary</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-28">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {domains.map((d: any, i: number) => {
                  const domainId = getDomainId(d)
                  const domainName = getDomainName(d)
                  const reachBadge = getReachabilityBadge(domainId, domainName)
                  const ReachIcon = reachBadge.icon
                  return (
                  <TableRow key={domainId || i}>
                    <TableCell className="font-medium">{domainName}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {statusIcon(getDomainStatus(d))}
                        <Badge variant={getDomainStatus(d) === 'verified' ? 'default' : 'secondary'}>{getDomainStatus(d)}</Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={reachBadge.variant} className="gap-1">
                        <ReachIcon className={`size-3 ${reachBadge.label === 'Checking...' ? 'animate-spin' : ''}`} />
                        {reachBadge.label}
                      </Badge>
                    </TableCell>
                    <TableCell>{d.isPrimary ? 'Yes' : 'No'}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{formatDate(getDomainCreatedAt(d))}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="size-7" onClick={() => runReachCheck(domainName, domainId)} title="Check reachability">
                          <RefreshCw className={`size-3.5 ${reachabilityMap[domainId]?.loading ? 'animate-spin' : ''}`} />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-7" onClick={() => { setRemoveId(domainId); setRemoveName(domainName); setRemoveOpen(true) }} title="Remove">
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )})}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Remove Domain</DialogTitle><DialogDescription>Are you sure? This will unlink the domain from this project.</DialogDescription></DialogHeader>
          <p className="text-sm text-muted-foreground">Remove <strong>{removeName}</strong>?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleRemove} disabled={removeDomain.isPending}>{removeDomain.isPending ? 'Removing...' : 'Remove'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
