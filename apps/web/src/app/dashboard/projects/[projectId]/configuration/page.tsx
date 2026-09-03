'use client'

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useEffect, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useParams } from 'next/navigation'
import {
  useProject,
  useProjectGeneralConfig,
  useUpdateProjectGeneralConfig,
  useUpdateProjectDeploymentConfig,
  useUpdateProjectSecurityConfig,
  useUpdateProjectResourceConfig,
  useUpdateProjectNotificationConfig,
  useProjectDeploymentConfig,
  useProjectSecurityConfig,
  useProjectResourceConfig,
  useProjectNotificationConfig,
} from '@/domains/project/hooks'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Siren } from 'lucide-react'
import { toast } from 'sonner'
import { shortId } from '../_utils/helpers'
import { ProjectContractsCard } from '../_components/project-contracts-card'

/**
 * Project Settings
 *
 * Single-concern page for PROJECT-LEVEL configuration only:
 * identity (name/description/base domain), deployment strategy, security,
 * resource defaults, and notifications. Environments and services now have
 * their own dedicated pages — this page is no longer a mega-tab hub.
 */
export default function DashboardProjectConfigurationPage() {
  const params = useParams<{ projectId: string }>()
  const projectId = params.projectId

  const { data: projectData, isLoading: projectLoading, error: projectError } = useProject(projectId)
  const { data: deploymentConfig } = useProjectDeploymentConfig(projectId)
  const { data: securityConfig } = useProjectSecurityConfig(projectId)
  const { data: resourceConfig } = useProjectResourceConfig(projectId)
  const { data: notificationConfig } = useProjectNotificationConfig(projectId)

  const updateProjectConfig = useUpdateProjectGeneralConfig()
  const updateDeploymentConfig = useUpdateProjectDeploymentConfig()
  const updateSecurityConfig = useUpdateProjectSecurityConfig()
  const updateResourceConfig = useUpdateProjectResourceConfig()
  const updateNotificationConfig = useUpdateProjectNotificationConfig()

  // ── Edit state for project general config ──────────────────────
  const [editingGeneral, setEditingGeneral] = useState(false)

  const generalForm = useForm({
    defaultValues: {
      name: '',
      description: '',
      baseDomain: '',
    },
    onSubmit: async ({ value }) => {
      try {
        await updateProjectConfig.mutateAsync({
          params: { id: projectId },
          body: { name: value.name.trim(), description: value.description.trim(), baseDomain: value.baseDomain.trim() } as any,
        })
        toast.success('Project configuration updated')
        setEditingGeneral(false)
      } catch (err) {
        toast.error('Failed to update project', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE })
      }
    },
  })

  useEffect(() => {
    if (projectData) {
      generalForm.reset({
        name: projectData.name ?? '',
        description: projectData.description ?? '',
        baseDomain: projectData.baseDomain ?? '',
      })
    }
  }, [projectData])

  // ── Config section edit state & handlers ───────────────────────
  const [editingDeployment, setEditingDeployment] = useState(false)
  const [editingSecurity, setEditingSecurity] = useState(false)
  const [editingResource, setEditingResource] = useState(false)
  const [editingNotification, setEditingNotification] = useState(false)

  const [editDeploy, setEditDeploy] = useState<any>({})
  const [editSecurity, setEditSecurity] = useState<any>({})
  const [editResource, setEditResource] = useState<any>({})
  const [editNotification, setEditNotification] = useState<any>({})

  useEffect(() => {
    if (deploymentConfig) setEditDeploy(deploymentConfig)
  }, [deploymentConfig])
  useEffect(() => {
    if (securityConfig) setEditSecurity(securityConfig)
  }, [securityConfig])
  useEffect(() => {
    if (resourceConfig) setEditResource(resourceConfig)
  }, [resourceConfig])
  useEffect(() => {
    if (notificationConfig) setEditNotification(notificationConfig)
  }, [notificationConfig])

  const handleSaveDeployment = async () => {
    try {
      await updateDeploymentConfig.mutateAsync({ params: { id: projectId }, body: editDeploy })
      toast.success('Deployment config saved'); setEditingDeployment(false)
    } catch (err) { toast.error('Failed to save', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE }) }
  }
  const handleSaveSecurity = async () => {
    try {
      await updateSecurityConfig.mutateAsync({ params: { id: projectId }, body: editSecurity })
      toast.success('Security config saved'); setEditingSecurity(false)
    } catch (err) { toast.error('Failed to save', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE }) }
  }
  const handleSaveResource = async () => {
    try {
      await updateResourceConfig.mutateAsync({ params: { id: projectId }, body: editResource })
      toast.success('Resource config saved'); setEditingResource(false)
    } catch (err) { toast.error('Failed to save', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE }) }
  }
  const handleSaveNotification = async () => {
    try {
      await updateNotificationConfig.mutateAsync({ params: { id: projectId }, body: editNotification })
      toast.success('Notification config saved'); setEditingNotification(false)
    } catch (err) { toast.error('Failed to save', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE }) }
  }

  // ── Loading / Error ────────────────────────────────────────────
  if (projectLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    )
  }

  if (projectError) {
    return (
      <Alert variant="destructive">
        <Siren className="size-4" />
        <AlertTitle>Failed to load project</AlertTitle>
        <AlertDescription>{isDefinedORPCError(projectError) ? getErrorMessage(projectError, 'Unknown error') : 'Unknown error'}</AlertDescription>
      </Alert>
    )
  }

  if (!projectData) {
    return (
      <Alert variant="destructive">
        <Siren className="size-4" />
        <AlertTitle>Project not found</AlertTitle>
        <AlertDescription>The project does not exist or has been deleted.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      {/* Project Info */}
      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Project Configuration</CardTitle>
            <CardDescription className="text-xs">{projectData.name ?? 'This project'}</CardDescription>
          </div>
          <div className="flex gap-2">
            {editingGeneral ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setEditingGeneral(false)}>Cancel</Button>
                <generalForm.Subscribe selector={(s) => s.isSubmitting}>
                  {(isSubmitting) => (
                    <Button size="sm" onClick={generalForm.handleSubmit} disabled={isSubmitting || updateProjectConfig.isPending}>
                      {updateProjectConfig.isPending ? 'Saving...' : 'Save'}
                    </Button>
                  )}
                </generalForm.Subscribe>
              </>
            ) : (
              <Button size="sm" onClick={() => { generalForm.reset({ name: projectData.name ?? '', description: projectData.description ?? '', baseDomain: projectData.baseDomain ?? '' }); setEditingGeneral(true) }}>
                Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Project ID</Label>
              <p className="text-sm text-muted-foreground font-mono">{shortId(projectData.id)}</p>
            </div>
            <div>
              <Label>Name</Label>
              {editingGeneral ? (
                <generalForm.Field name="name">
                  {(field) => (
                    <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} className="h-8 text-sm" />
                  )}
                </generalForm.Field>
              ) : (
                <p className="text-sm text-muted-foreground">{projectData.name}</p>
              )}
            </div>
            <div>
              <Label>Description</Label>
              {editingGeneral ? (
                <generalForm.Field name="description">
                  {(field) => (
                    <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} className="h-8 text-sm" />
                  )}
                </generalForm.Field>
              ) : (
                <p className="text-sm text-muted-foreground">{projectData.description ?? 'No description'}</p>
              )}
            </div>
            <div>
              <Label>Base Domain</Label>
              {editingGeneral ? (
                <generalForm.Field name="baseDomain">
                  {(field) => (
                    <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} className="h-8 text-sm" placeholder="example.com" />
                  )}
                </generalForm.Field>
              ) : (
                <p className="text-sm text-muted-foreground">{projectData.baseDomain ?? 'Not configured'}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ═══════ DEPLOYMENT CONFIG ═══════ */}
      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle className="text-base">Deployment Config</CardTitle><CardDescription>Deployment strategy, timeouts, rollback settings.</CardDescription></div>
          {editingDeployment ? (
            <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setEditingDeployment(false)}>Cancel</Button><Button size="sm" onClick={handleSaveDeployment} disabled={updateDeploymentConfig.isPending}>{updateDeploymentConfig.isPending ? 'Saving...' : 'Save'}</Button></div>
          ) : <Button size="sm" variant="outline" onClick={() => setEditingDeployment(true)}>Edit</Button>}
        </CardHeader>
        <CardContent>
          {editingDeployment ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3"><div><Label>Auto cleanup (days)</Label><Input type="number" value={editDeploy.autoCleanupDays ?? ''} onChange={(e) => setEditDeploy({...editDeploy, autoCleanupDays: Number(e.target.value)})} /></div><div><Label>Max preview envs</Label><Input type="number" value={editDeploy.maxPreviewEnvironments ?? ''} onChange={(e) => setEditDeploy({...editDeploy, maxPreviewEnvironments: Number(e.target.value)})} /></div></div>
              <div className="grid grid-cols-2 gap-3"><div><Label>Strategy</Label><Select value={editDeploy.deploymentStrategy ?? ''} onValueChange={(v) => setEditDeploy({...editDeploy, deploymentStrategy: v})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="rolling">Rolling</SelectItem><SelectItem value="blue-green">Blue-Green</SelectItem><SelectItem value="canary">Canary</SelectItem></SelectContent></Select></div><div><Label>Health check timeout (s)</Label><Input type="number" value={editDeploy.healthCheckTimeout ?? ''} onChange={(e) => setEditDeploy({...editDeploy, healthCheckTimeout: Number(e.target.value)})} /></div></div>
              <div className="flex items-center gap-2"><Switch checked={editDeploy.enableRollback ?? false} onCheckedChange={(v) => setEditDeploy({...editDeploy, enableRollback: v})} /><Label>Enable rollback</Label></div>
              <div className="flex items-center gap-2"><Switch checked={editDeploy.requireApprovalForProduction ?? false} onCheckedChange={(v) => setEditDeploy({...editDeploy, requireApprovalForProduction: v})} /><Label>Require approval for production</Label></div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
              <div><span className="text-muted-foreground">Strategy:</span> {deploymentConfig?.deploymentStrategy ?? '-'}</div>
              <div><span className="text-muted-foreground">Rollback:</span> {deploymentConfig?.enableRollback ? 'Enabled' : 'Disabled'}</div>
              <div><span className="text-muted-foreground">Health timeout:</span> {deploymentConfig?.healthCheckTimeout ?? '-'}s</div>
              <div><span className="text-muted-foreground">Prod approval:</span> {deploymentConfig?.requireApprovalForProduction ? 'Required' : 'Not required'}</div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══════ SECURITY CONFIG ═══════ */}
      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle className="text-base">Security Config</CardTitle><CardDescription>HTTPS redirect, domain whitelist, basic auth.</CardDescription></div>
          {editingSecurity ? (
            <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setEditingSecurity(false)}>Cancel</Button><Button size="sm" onClick={handleSaveSecurity} disabled={updateSecurityConfig.isPending}>{updateSecurityConfig.isPending ? 'Saving...' : 'Save'}</Button></div>
          ) : <Button size="sm" variant="outline" onClick={() => setEditingSecurity(true)}>Edit</Button>}
        </CardHeader>
        <CardContent>
          {editingSecurity ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2"><Switch checked={editSecurity.enableHttpsRedirect ?? false} onCheckedChange={(v) => setEditSecurity({...editSecurity, enableHttpsRedirect: v})} /><Label>HTTPS redirect</Label></div>
              <div className="flex items-center gap-2"><Switch checked={editSecurity.enableBasicAuth ?? false} onCheckedChange={(v) => setEditSecurity({...editSecurity, enableBasicAuth: v})} /><Label>Basic auth</Label></div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
              <div><span className="text-muted-foreground">HTTPS redirect:</span> {securityConfig?.enableHttpsRedirect ? 'Enabled' : 'Disabled'}</div>
              <div><span className="text-muted-foreground">Basic auth:</span> {securityConfig?.enableBasicAuth ? 'Enabled' : 'Disabled'}</div>
              <div><span className="text-muted-foreground">Allowed domains:</span> {(securityConfig as any)?.allowedDomains?.length ?? 0}</div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══════ RESOURCE CONFIG ═══════ */}
      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle className="text-base">Resource Config</CardTitle><CardDescription>Default CPU, memory, and storage limits.</CardDescription></div>
          {editingResource ? (
            <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setEditingResource(false)}>Cancel</Button><Button size="sm" onClick={handleSaveResource} disabled={updateResourceConfig.isPending}>{updateResourceConfig.isPending ? 'Saving...' : 'Save'}</Button></div>
          ) : <Button size="sm" variant="outline" onClick={() => setEditingResource(true)}>Edit</Button>}
        </CardHeader>
        <CardContent>
          {editingResource ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div><Label>CPU limit</Label><Input value={editResource.defaultCpuLimit ?? ''} onChange={(e) => setEditResource({...editResource, defaultCpuLimit: e.target.value})} /></div>
                <div><Label>Memory limit</Label><Input value={editResource.defaultMemoryLimit ?? ''} onChange={(e) => setEditResource({...editResource, defaultMemoryLimit: e.target.value})} /></div>
                <div><Label>Storage limit</Label><Input value={editResource.defaultStorageLimit ?? ''} onChange={(e) => setEditResource({...editResource, defaultStorageLimit: e.target.value})} /></div>
              </div>
              <div><Label>Max services per project</Label><Input type="number" value={editResource.maxServicesPerProject ?? ''} onChange={(e) => setEditResource({...editResource, maxServicesPerProject: Number(e.target.value)})} /></div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
              <div><span className="text-muted-foreground">CPU:</span> {resourceConfig?.defaultCpuLimit ?? '-'}</div>
              <div><span className="text-muted-foreground">Memory:</span> {resourceConfig?.defaultMemoryLimit ?? '-'}</div>
              <div><span className="text-muted-foreground">Storage:</span> {resourceConfig?.defaultStorageLimit ?? '-'}</div>
              <div><span className="text-muted-foreground">Max services:</span> {resourceConfig?.maxServicesPerProject ?? '-'}</div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══════ NOTIFICATION CONFIG ═══════ */}
      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle className="text-base">Notification Config</CardTitle><CardDescription>Email and Slack notification settings.</CardDescription></div>
          {editingNotification ? (
            <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setEditingNotification(false)}>Cancel</Button><Button size="sm" onClick={handleSaveNotification} disabled={updateNotificationConfig.isPending}>{updateNotificationConfig.isPending ? 'Saving...' : 'Save'}</Button></div>
          ) : <Button size="sm" variant="outline" onClick={() => setEditingNotification(true)}>Edit</Button>}
        </CardHeader>
        <CardContent>
          {editingNotification ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2"><Switch checked={editNotification.enableEmailNotifications ?? false} onCheckedChange={(v) => setEditNotification({...editNotification, enableEmailNotifications: v})} /><Label>Email notifications</Label></div>
              <div className="flex items-center gap-2"><Switch checked={editNotification.enableSlackNotifications ?? false} onCheckedChange={(v) => setEditNotification({...editNotification, enableSlackNotifications: v})} /><Label>Slack notifications</Label></div>
              <div className="flex items-center gap-2"><Switch checked={editNotification.notifyOnDeploymentSuccess ?? false} onCheckedChange={(v) => setEditNotification({...editNotification, notifyOnDeploymentSuccess: v})} /><Label>Notify on deploy success</Label></div>
              <div className="flex items-center gap-2"><Switch checked={editNotification.notifyOnDeploymentFailure ?? false} onCheckedChange={(v) => setEditNotification({...editNotification, notifyOnDeploymentFailure: v})} /><Label>Notify on deploy failure</Label></div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
              <div><span className="text-muted-foreground">Email:</span> {notificationConfig?.enableEmailNotifications ? 'Enabled' : 'Disabled'}</div>
              <div><span className="text-muted-foreground">Slack:</span> {notificationConfig?.enableSlackNotifications ? 'Enabled' : 'Disabled'}</div>
              <div><span className="text-muted-foreground">Deploy success:</span> {notificationConfig?.notifyOnDeploymentSuccess ? 'Notify' : 'Silent'}</div>
              <div><span className="text-muted-foreground">Deploy failure:</span> {notificationConfig?.notifyOnDeploymentFailure ? 'Notify' : 'Silent'}</div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Contract registry (interfaces services implement — DI semantics) ── */}
      <ProjectContractsCard projectId={projectId} />
    </div>
  )
}
