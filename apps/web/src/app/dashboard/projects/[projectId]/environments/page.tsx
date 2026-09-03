'use client'

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useMemo, useState, useCallback } from 'react'
import { useForm } from '@tanstack/react-form'
import { useParams } from 'next/navigation'
import { ENVIRONMENT_KINDS, environmentKindSchema, type EnvironmentKind } from '@repo/contracts-common'
import {
  useProjectEnvironments,
  useProjectEnvironmentStatus,
  useRefreshProjectEnvironmentStatus,
  useProjectServiceEnvironmentLinks,
  useUpsertServiceEnvironmentLink,
  useCreateProjectEnvironment,
  useUpdateProjectEnvironment,
  useDeleteProjectEnvironment,
  useCloneProjectEnvironment,
  useProjectVariableTemplates,
  useCreateProjectVariableTemplate,
  useUpdateProjectVariableTemplate,
  useDeleteProjectVariableTemplate,
} from '@/domains/project/hooks'
import { useServiceList } from '@/domains/service/hooks'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Siren, Plus, Pencil, Trash2, Copy, Layers, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { shortId } from '../_utils/helpers'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/shadcn/dialog'
import { z } from 'zod/v4'

const envNameSchema = z.object({
  name: z.string().min(1, 'Environment name is required'),
  kind: z.enum(environmentKindSchema.options).default('stable'),
  description: z.string().optional(),
})

/**
 * Project Environments
 *
 * Environments are first-class primitives: free-form name + KIND
 * (stable | preview | ephemeral) + per-env rules + optional trigger.
 * Also owns the Service × Environment matrix (which services are active
 * in which environment) and reusable variable templates.
 */
export default function DashboardProjectEnvironmentsPage() {
  const params = useParams<{ projectId: string }>()
  const projectId = params.projectId

  // ── Data ───────────────────────────────────────────────────────
  const { data: environmentsData, isLoading: envLoading, error: envError, refetch: refetchEnvs } = useProjectEnvironments(projectId)
  const { data: envStatusesData } = useProjectEnvironmentStatus(projectId)
  const { data: envLinksData } = useProjectServiceEnvironmentLinks(projectId)
  const { data: servicesData } = useServiceList({ query: { limit: 100, offset: 0 } })
  const { data: variableTemplatesData } = useProjectVariableTemplates(projectId)

  // ── Mutations ──────────────────────────────────────────────────
  const createEnvironment = useCreateProjectEnvironment()
  const updateEnvironment = useUpdateProjectEnvironment()
  const deleteEnvironment = useDeleteProjectEnvironment()
  const cloneEnvironment = useCloneProjectEnvironment()
  const upsertServiceEnvironmentLink = useUpsertServiceEnvironmentLink()
  const refreshEnvironmentStatus = useRefreshProjectEnvironmentStatus()
  const createVariableTemplate = useCreateProjectVariableTemplate()
  const updateVariableTemplate = useUpdateProjectVariableTemplate()
  const deleteVariableTemplate = useDeleteProjectVariableTemplate()

  // Env id → status lookup (from getAllEnvironmentStatuses)
  const envStatusMap = useMemo(() => {
    const map = new Map<string, string>()
    const statuses = Array.isArray(envStatusesData) ? envStatusesData : (envStatusesData as any)?.statuses ?? (envStatusesData as any)?.environments ?? []
    for (const s of statuses) {
      const id = s.environmentId ?? s.id
      if (id) map.set(id, s.status ?? 'unknown')
    }
    return map
  }, [envStatusesData])

  // ── Env CRUD dialog state ──────────────────────────────────────
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingEnv, setEditingEnv] = useState<any>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingEnv, setDeletingEnv] = useState<any>(null)
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false)
  const [cloningEnv, setCloningEnv] = useState<any>(null)

  const createEnvForm = useForm({
    defaultValues: { name: '', kind: 'stable' as EnvironmentKind, description: '' },
    onSubmit: async ({ value }) => {
      const parsed = envNameSchema.safeParse(value)
      if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? 'Invalid input'); return }
      try {
        await createEnvironment.mutateAsync({ params: { id: projectId }, body: { name: value.name.trim(), kind: value.kind as EnvironmentKind, description: value.description?.trim() || undefined } })
        toast.success('Environment created')
        setCreateDialogOpen(false)
      } catch (err) { toast.error('Failed to create environment', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE }) }
    },
  })

  const editEnvForm = useForm({
    defaultValues: { name: '', kind: 'stable' as EnvironmentKind, description: '' },
    onSubmit: async ({ value }) => {
      const parsed = envNameSchema.safeParse(value)
      if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? 'Invalid input'); return }
      if (!editingEnv) return
      try {
        await updateEnvironment.mutateAsync({ params: { id: projectId, environmentId: editingEnv.id }, body: { name: value.name.trim(), kind: value.kind as EnvironmentKind, description: value.description?.trim() || undefined } })
        toast.success('Environment updated')
        setEditDialogOpen(false)
        setEditingEnv(null)
      } catch (err) { toast.error('Failed to update environment', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE }) }
    },
  })

  const cloneEnvForm = useForm({
    defaultValues: { name: '', kind: 'stable' as EnvironmentKind },
    onSubmit: async ({ value }) => {
      const parsed = envNameSchema.safeParse(value)
      if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? 'Invalid input'); return }
      if (!cloningEnv) return
      try {
        await cloneEnvironment.mutateAsync({ params: { id: projectId, environmentId: cloningEnv.id }, body: { name: value.name.trim(), kind: value.kind as EnvironmentKind } })
        toast.success('Environment cloned')
        setCloneDialogOpen(false)
        setCloningEnv(null)
      } catch (err) { toast.error('Failed to clone environment', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE }) }
    },
  })

  const handleOpenEdit = (env: any) => {
    setEditingEnv(env)
    editEnvForm.reset({ name: env.name ?? '', kind: env.kind ?? 'stable', description: env.description ?? '' })
    setEditDialogOpen(true)
  }
  const handleOpenClone = (env: any) => {
    setCloningEnv(env)
    cloneEnvForm.reset({ name: `${env.name ?? 'Environment'} (clone)`, kind: env.kind ?? 'stable' })
    setCloneDialogOpen(true)
  }
  const handleOpenDelete = (env: any) => { setDeletingEnv(env); setDeleteDialogOpen(true) }

  const handleDeleteEnvironment = async () => {
    if (!deletingEnv) return
    try {
      await deleteEnvironment.mutateAsync({ params: { id: projectId, environmentId: deletingEnv.id } })
      toast.success('Environment deleted')
      setDeleteDialogOpen(false)
      setDeletingEnv(null)
    } catch (err) { toast.error('Failed to delete environment', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE }) }
  }

  // ── Derived data ───────────────────────────────────────────────
  const environments = useMemo(() => {
    if (environmentsData) return Array.isArray(environmentsData) ? environmentsData : (environmentsData as any).environments ?? []
    return []
  }, [environmentsData])

  const allProjectServices = useMemo(() => {
    const all = servicesData?.data ?? []
    return all.filter((s: any) => s.projectId === projectId)
  }, [servicesData, projectId])

  const envLinkMap = useMemo(() => {
    const map = new Map<string, any>()
    const links = Array.isArray(envLinksData) ? envLinksData : (envLinksData as any)?.links ?? []
    for (const l of links) map.set(`${l.serviceId}:${l.environmentId}`, l)
    return map
  }, [envLinksData])

  // Set of `${serviceId}:${environmentId}` cells currently toggling
  const [pendingLinkKeys, setPendingLinkKeys] = useState<Set<string>>(new Set())

  const toggleServiceEnvLink = useCallback(async (serviceId: string, environmentId: string, enabled: boolean) => {
    const key = `${serviceId}:${environmentId}`
    setPendingLinkKeys((prev) => new Set(prev).add(key))
    try {
      await upsertServiceEnvironmentLink.mutateAsync({
        params: { id: projectId },
        body: { serviceId, environmentId, isEnabled: enabled },
      })
      toast.success(enabled ? 'Service enabled in environment' : 'Service disabled in environment')
    } catch (err) {
      toast.error('Failed to update link', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE })
    } finally {
      setPendingLinkKeys((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }, [upsertServiceEnvironmentLink, projectId])

  // ── Variable templates ─────────────────────────────────────────
  const variableTemplates = useMemo(() => {
    if (!variableTemplatesData) return []
    const d = variableTemplatesData as any
    return d.templates ?? (Array.isArray(d) ? d : [])
  }, [variableTemplatesData])

  const [createTplOpen, setCreateTplOpen] = useState(false)
  const [newTplName, setNewTplName] = useState('')
  const [newTplDesc, setNewTplDesc] = useState('')
  const [editTplOpen, setEditTplOpen] = useState(false)
  const [editTplId, setEditTplId] = useState<string | null>(null)
  const [editTplName, setEditTplName] = useState('')
  const [editTplDesc, setEditTplDesc] = useState('')
  const [deleteTplOpen, setDeleteTplOpen] = useState(false)
  const [deleteTpl, setDeleteTpl] = useState<any>(null)

  const handleCreateTpl = async () => {
    if (!newTplName.trim()) { toast.error('Template name is required'); return }
    try {
      await createVariableTemplate.mutateAsync({ params: { id: projectId }, body: { name: newTplName.trim(), description: newTplDesc.trim() || undefined } })
      toast.success('Variable template created'); setCreateTplOpen(false); setNewTplName(''); setNewTplDesc('')
    } catch (err) { toast.error('Failed to create template', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE }) }
  }
  const handleOpenEditTpl = (tpl: any) => { setEditTplId(tpl.id); setEditTplName(tpl.name ?? ''); setEditTplDesc(tpl.description ?? ''); setEditTplOpen(true) }
  const handleUpdateTpl = async () => {
    if (!editTplId || !editTplName.trim()) { toast.error('Template name is required'); return }
    try {
      await updateVariableTemplate.mutateAsync({ params: { id: projectId, templateId: editTplId }, body: { name: editTplName.trim(), description: editTplDesc.trim() || undefined } })
      toast.success('Variable template updated'); setEditTplOpen(false); setEditTplId(null)
    } catch (err) { toast.error('Failed to update template', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE }) }
  }
  const handleOpenDeleteTpl = (tpl: any) => { setDeleteTpl(tpl); setDeleteTplOpen(true) }
  const handleDeleteTpl = async () => {
    if (!deleteTpl) return
    try {
      await deleteVariableTemplate.mutateAsync({ params: { id: projectId, templateId: deleteTpl.id } })
      toast.success('Variable template deleted'); setDeleteTplOpen(false); setDeleteTpl(null)
    } catch (err) { toast.error('Failed to delete template', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE }) }
  }

  // ── Loading / Error ────────────────────────────────────────────
  if (envLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    )
  }

  if (envError) {
    return (
      <Alert variant="destructive">
        <Siren className="size-4" />
        <AlertTitle>Failed to load environments</AlertTitle>
        <AlertDescription>
          {isDefinedORPCError(envError) ? getErrorMessage(envError, 'An unexpected error occurred.') : 'An unexpected error occurred.'}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      {/* Environments table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Environments</CardTitle>
            <CardDescription>
              First-class deployment environments. Kind: stable (long-lived) · preview (PR/branch-triggered) · ephemeral (short-lived).
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void refetchEnvs()} title="Refresh environments">
              <RefreshCw className="size-4" />
            </Button>
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="mr-2 size-4" />Add Environment</Button>
              </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Create Environment</DialogTitle>
                <DialogDescription>Add a new deployment environment primitive.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <createEnvForm.Field name="name">
                  {(field) => (
                    <div className="grid gap-2">
                      <Label>Name</Label>
                      <Input placeholder="e.g. staging" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
                    </div>
                  )}
                </createEnvForm.Field>
                <createEnvForm.Field name="kind">
                  {(field) => (
                    <div className="grid gap-2">
                      <Label>Kind</Label>
                      <Select value={field.state.value} onValueChange={(v) => field.handleChange(v as EnvironmentKind)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ENVIRONMENT_KINDS.map((k) => (<SelectItem key={k} value={k}>{k}</SelectItem>))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">stable = long-lived · preview = PR/branch-triggered · ephemeral = short-lived</p>
                    </div>
                  )}
                </createEnvForm.Field>
                <createEnvForm.Field name="description">
                  {(field) => (
                    <div className="grid gap-2">
                      <Label>Description (optional)</Label>
                      <Input placeholder="Brief description" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
                    </div>
                  )}
                </createEnvForm.Field>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
                <createEnvForm.Subscribe selector={(s) => s.isSubmitting}>
                  {(isSubmitting) => (
                    <Button onClick={createEnvForm.handleSubmit} disabled={isSubmitting || createEnvironment.isPending}>
                      {createEnvironment.isPending ? 'Creating...' : 'Create'}
                    </Button>
                  )}
                </createEnvForm.Subscribe>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {environments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Layers className="mb-4 size-12 text-muted-foreground/40" />
              <p className="text-lg font-medium">No environments configured</p>
              <p className="text-sm text-muted-foreground">Create an environment to get started.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-40">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {environments.map((env: any, i: number) => {
                  const liveStatus = envStatusMap.get(env.id) ?? env.status ?? 'unknown'
                  return (
                    <TableRow key={env.id ?? i}>
                      <TableCell className="font-medium">{env.name ?? env.id ?? `Environment ${i + 1}`}</TableCell>
                      <TableCell>
                        <Badge variant={env.kind === 'preview' ? 'secondary' as const : env.kind === 'ephemeral' ? 'outline' as const : 'default' as const}>{env.kind ?? 'stable'}</Badge>
                      </TableCell>
                      <TableCell><Badge variant="outline">{env.type ?? '—'}</Badge></TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Badge variant={liveStatus === 'healthy' || liveStatus === 'active' ? 'default' as const : liveStatus === 'failed' || liveStatus === 'error' ? 'destructive' as const : 'secondary' as const}>{liveStatus}</Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            title="Refresh status"
                            aria-label={`Refresh ${env.name ?? env.id} status`}
                            disabled={refreshEnvironmentStatus.isPending}
                            onClick={() => void refreshEnvironmentStatus.mutateAsync({ params: { id: projectId, environmentId: env.id } })}
                          >
                            <RefreshCw className="size-3" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="size-8" onClick={() => handleOpenEdit(env)} title="Edit" aria-label={`Edit ${env.name ?? env.id}`}><Pencil className="size-4" /></Button>
                          <Button variant="ghost" size="icon" className="size-8" onClick={() => handleOpenClone(env)} title="Clone" aria-label={`Clone ${env.name ?? env.id}`}><Copy className="size-4" /></Button>
                          <Button variant="ghost" size="icon" className="size-8" onClick={() => handleOpenDelete(env)} title="Delete" aria-label={`Delete ${env.name ?? env.id}`}><Trash2 className="size-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Service × Environment matrix */}
      <Card>
        <CardHeader>
          <CardTitle>Service × Environment Matrix</CardTitle>
          <CardDescription>Which services are active in which environment. Sub-services are first-class here — inherit parent config unless overridden per link.</CardDescription>
        </CardHeader>
        <CardContent>
          {environments.length === 0 || allProjectServices.length === 0 ? (
            <p className="text-sm text-muted-foreground">Create environments and services to build the matrix.</p>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-45">Service</TableHead>
                    {environments.map((env: any) => (
                      <TableHead key={env.id} className="text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span>{env.name}</span>
                          <Badge variant={env.kind === 'preview' ? 'secondary' as const : env.kind === 'ephemeral' ? 'outline' as const : 'default' as const} className="text-[10px]">{env.kind}</Badge>
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allProjectServices.map((svc: any) => (
                    <TableRow key={svc.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{svc.name}</span>
                          {svc.parentId && <Badge variant="outline" className="text-[10px]">sub</Badge>}
                        </div>
                      </TableCell>
                      {environments.map((env: any) => {
                        const link = envLinkMap.get(`${svc.id}:${env.id}`)
                        const enabled = link?.isEnabled ?? true
                        const cellKey = `${svc.id}:${env.id}`
                        const cellPending = pendingLinkKeys.has(cellKey)
                        return (
                          <TableCell key={env.id} className="text-center">
                            <Switch
                              checked={enabled}
                              onCheckedChange={(v) => toggleServiceEnvLink(svc.id, env.id, v)}
                              disabled={cellPending}
                              aria-label={`${svc.name} in ${env.name}`}
                            />
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Variable templates */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Variable Templates</CardTitle>
            <CardDescription>Reusable variable templates for environment configuration.</CardDescription>
          </div>
          <Dialog open={createTplOpen} onOpenChange={setCreateTplOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-2 size-4" />Add Template</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader><DialogTitle>Create Variable Template</DialogTitle><DialogDescription>Define reusable environment variable placeholders.</DialogDescription></DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2"><Label>Name</Label><Input value={newTplName} onChange={(e) => setNewTplName(e.target.value)} placeholder="e.g. Database Config" /></div>
                <div className="grid gap-2"><Label>Description (optional)</Label><Input value={newTplDesc} onChange={(e) => setNewTplDesc(e.target.value)} /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateTplOpen(false)}>Cancel</Button>
                <Button onClick={handleCreateTpl} disabled={createVariableTemplate.isPending}>{createVariableTemplate.isPending ? 'Creating...' : 'Create'}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {variableTemplates.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No variable templates defined. Create one to reuse environment variables across services.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variableTemplates.map((tpl: any, i: number) => (
                  <TableRow key={tpl.id ?? i}>
                    <TableCell className="font-medium">{tpl.name}</TableCell>
                    <TableCell className="text-muted-foreground">{tpl.description ?? '-'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => handleOpenEditTpl(tpl)}><Pencil className="size-4" /></Button>
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => handleOpenDeleteTpl(tpl)}><Trash2 className="size-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit Environment Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Edit Environment</DialogTitle><DialogDescription>Update environment settings.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-4">
            <editEnvForm.Field name="name">
              {(field) => (
                <div className="grid gap-2">
                  <Label>Name</Label>
                  <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
                </div>
              )}
            </editEnvForm.Field>
            <editEnvForm.Field name="kind">
              {(field) => (
                <div className="grid gap-2">
                  <Label>Kind</Label>
                  <Select value={field.state.value} onValueChange={(v) => field.handleChange(v as EnvironmentKind)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ENVIRONMENT_KINDS.map((k) => (<SelectItem key={k} value={k}>{k}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </editEnvForm.Field>
            <editEnvForm.Field name="description">
              {(field) => (
                <div className="grid gap-2">
                  <Label>Description (optional)</Label>
                  <Input value={field.state.value ?? ''} onChange={(e) => field.handleChange(e.target.value)} />
                </div>
              )}
            </editEnvForm.Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <editEnvForm.Subscribe selector={(s) => s.isSubmitting}>
              {(isSubmitting) => (
                <Button onClick={editEnvForm.handleSubmit} disabled={isSubmitting || updateEnvironment.isPending}>
                  {updateEnvironment.isPending ? 'Saving...' : 'Save'}
                </Button>
              )}
            </editEnvForm.Subscribe>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Environment Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Delete Environment</DialogTitle><DialogDescription>Are you sure? This action cannot be undone.</DialogDescription></DialogHeader>
          <p className="text-sm text-muted-foreground">Environment: <strong>{deletingEnv?.name ?? deletingEnv?.id}</strong></p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteEnvironment} disabled={deleteEnvironment.isPending}>{deleteEnvironment.isPending ? 'Deleting...' : 'Delete'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clone Environment Dialog */}
      <Dialog open={cloneDialogOpen} onOpenChange={setCloneDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Clone Environment</DialogTitle><DialogDescription>Create a copy of this environment.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-4">
            <cloneEnvForm.Field name="name">
              {(field) => (
                <div className="grid gap-2">
                  <Label>New Name</Label>
                  <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
                </div>
              )}
            </cloneEnvForm.Field>
            <cloneEnvForm.Field name="kind">
              {(field) => (
                <div className="grid gap-2">
                  <Label>Kind</Label>
                  <Select value={field.state.value} onValueChange={(v) => field.handleChange(v as EnvironmentKind)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ENVIRONMENT_KINDS.map((k) => (<SelectItem key={k} value={k}>{k}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </cloneEnvForm.Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloneDialogOpen(false)}>Cancel</Button>
            <cloneEnvForm.Subscribe selector={(s) => s.isSubmitting}>
              {(isSubmitting) => (
                <Button onClick={cloneEnvForm.handleSubmit} disabled={isSubmitting || cloneEnvironment.isPending}>
                  {cloneEnvironment.isPending ? 'Cloning...' : 'Clone'}
                </Button>
              )}
            </cloneEnvForm.Subscribe>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Template Dialog */}
      <Dialog open={editTplOpen} onOpenChange={setEditTplOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Edit Variable Template</DialogTitle><DialogDescription>Update template name and description.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2"><Label>Name</Label><Input value={editTplName} onChange={(e) => setEditTplName(e.target.value)} /></div>
            <div className="grid gap-2"><Label>Description</Label><Input value={editTplDesc} onChange={(e) => setEditTplDesc(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTplOpen(false)}>Cancel</Button>
            <Button onClick={handleUpdateTpl} disabled={updateVariableTemplate.isPending}>{updateVariableTemplate.isPending ? 'Saving...' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Template Dialog */}
      <Dialog open={deleteTplOpen} onOpenChange={setDeleteTplOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Delete Variable Template</DialogTitle><DialogDescription>Are you sure? This cannot be undone.</DialogDescription></DialogHeader>
          <p className="text-sm text-muted-foreground">Delete template: <strong>{deleteTpl?.name}</strong></p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTplOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteTpl} disabled={deleteVariableTemplate.isPending}>{deleteVariableTemplate.isPending ? 'Deleting...' : 'Delete'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
