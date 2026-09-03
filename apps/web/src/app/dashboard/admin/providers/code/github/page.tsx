'use client'

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage, isDomainError } from "@/lib/orpc/typed-errors";
import { useState, useCallback } from 'react'
import { useForm } from '@tanstack/react-form'
import { useGitHubApps, useCreateGitHubApp, useDeleteGitHubApp, useGitHubManifestInit, useGitHubSelfCheck, useGitHubCreateFromPat } from '@/domains/github-apps/hooks'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
import { Field, FieldLabel, FieldDescription, FieldError } from '@repo/ui/components/shadcn/field'
import { Siren, Plus, Trash2, GitFork, ArrowLeft, Key, ExternalLink, Shield } from 'lucide-react'
import { toast } from 'sonner'
import { AuthDashboardAdminProvidersCode } from '@/routes'
import { z } from 'zod/v4'

const githubCreateSchema = z.object({
  name: z.string().min(1, 'App name is required'),
  appId: z.string().min(1, 'GitHub App ID is required'),
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client Secret is required'),
  privateKey: z.string().min(1, 'Private Key is required'),
  webhookSecret: z.string().min(1, 'Webhook Secret is required'),
})

const patSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  pat: z.string().min(1, 'Personal Access Token is required'),
})

export default function AdminProvidersGithubPage() {
  const { data, isLoading, error, refetch } = useGitHubApps()
  const createApp = useCreateGitHubApp()
  const deleteApp = useDeleteGitHubApp()
  const manifestInit = useGitHubManifestInit()
  const { data: selfCheckRaw, isLoading: selfCheckLoading } = useGitHubSelfCheck()
  const selfCheck = selfCheckRaw as { reachable: boolean; publicUrl: string; error?: string; latencyMs?: number } | undefined
  const createFromPat = useGitHubCreateFromPat()

  const apps = data?.apps ?? []

  // Manual create form
  const [createOpen, setCreateOpen] = useState(false)
  const createForm = useForm({
    defaultValues: { name: '', appId: '', clientId: '', clientSecret: '', privateKey: '', webhookSecret: '' },
    onSubmit: async ({ value }) => {
      const parsed = githubCreateSchema.safeParse(value)
      if (!parsed.success) return
      try {
        await createApp.mutateAsync(parsed.data)
        toast.success('GitHub App added')
        setCreateOpen(false)
        createForm.reset()
      } catch (err) {
        toast.error("Failed to add GitHub App", {
          description: isDomainError(err, "CONFLICT")
            ? "A GitHub App with this name already exists."
            : getErrorMessage(err, "Unknown error"),
        })
      }
    },
  })

  // PAT form
  const [patOpen, setPatOpen] = useState(false)
  const patForm = useForm({
    defaultValues: { name: '', pat: '' },
    onSubmit: async ({ value }) => {
      const parsed = patSchema.safeParse(value)
      if (!parsed.success) return
      try {
        await createFromPat.mutateAsync(parsed.data)
        toast.success('GitHub App created from PAT')
        setPatOpen(false)
        patForm.reset()
      } catch (err) {
        toast.error('Failed to create from PAT', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
      }
    },
  })

  const handleDelete = useCallback(async (id: string, appName: string) => {
    if (!confirm(`Remove "${appName}"? This cannot be undone.`)) return
    try {
      await deleteApp.mutateAsync({ params: { id } })
      toast.success('GitHub App removed')
    } catch (err) {
      toast.error('Failed to remove', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    }
  }, [deleteApp])

  const handleManifestFlow = useCallback(async () => {
    if (selfCheck && !selfCheck.reachable) {
      toast.error('API not reachable', {
        description: `Cannot reach ${selfCheck.publicUrl}. The manifest flow requires the API to be publicly accessible.`,
        duration: 8000,
      })
      return
    }
    try {
      // GitHub redirects the browser to this web-app callback page (which
      // holds the session cookie). That page POSTs the code to the protected
      // API. Direct API callback would 401 — cross-site redirect drops cookies.
      const redirectUrl = `${window.location.origin}/dashboard/admin/providers/code/github/callback`
      const resultRaw = await manifestInit.mutateAsync({ redirectUrl } as any)
      const result = resultRaw as unknown as { target: string; manifest: string; url: string; reachable: boolean; publicUrl: string; appName: string }
      if (!result.reachable) {
        toast.warning('API reachability check failed', {
          description: 'Webhook callbacks may not work if your API is not publicly reachable.',
          duration: 8000,
        })
      }
      // GitHub's manifest flow requires POSTing the manifest definition to
      // /settings/apps/new so the create-app page is PREFILLED. We submit a
      // hidden form into a new tab (auto-submitting form POST).
      const form = document.createElement('form')
      form.method = 'POST'
      form.action = result.target
      form.target = '_blank'
      form.rel = 'noopener noreferrer'
      const input = document.createElement('input')
      input.type = 'hidden'
      input.name = 'manifest'
      input.value = result.manifest
      form.appendChild(input)
      document.body.appendChild(form)
      form.submit()
      form.remove()
      toast.success('GitHub App creation page opened', {
        description: `App "${result.appName}" pre-filled on GitHub. After confirming, credentials are stored automatically.`,
      })
    } catch (err) {
      toast.error('Failed to start manifest flow', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    }
  }, [manifestInit, selfCheck])

  if (isLoading) return <div className="space-y-6"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full rounded-xl" /></div>
  if (error) return <Alert variant="destructive"><Siren className="size-4" /><AlertTitle>Failed to load</AlertTitle><AlertDescription>{isDefinedORPCError(error) ? getErrorMessage(error) : 'Error loading GitHub Apps'}</AlertDescription></Alert>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <AuthDashboardAdminProvidersCode.Link>
          <Button variant="ghost" size="sm" className="-ml-2"><ArrowLeft className="mr-1 size-4" />Code Providers</Button>
        </AuthDashboardAdminProvidersCode.Link>
      </div>

      <div className="flex items-center gap-2">
        <div className="rounded-lg bg-gray-100 dark:bg-gray-800 p-2"><GitFork className="size-5 text-gray-700 dark:text-gray-300" /></div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">GitHub</h1>
          <p className="text-sm text-muted-foreground">
            Connect GitHub to enable source code integration. Use <strong>OAuth</strong> to auto-create a GitHub App,
            or <strong>API Key (PAT)</strong> for a simpler setup.
          </p>
        </div>
      </div>

      {/* Self-check status */}
      {selfCheck && (
        <div className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${selfCheck.reachable ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30' : 'border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/30'}`}>
          <div className={`size-2 rounded-full ${selfCheck.reachable ? 'bg-green-500' : 'bg-yellow-500'}`} />
          <span>
            <strong>API:</strong> {selfCheck.publicUrl} — {selfCheck.reachable ? `reachable (${selfCheck.latencyMs}ms)` : `not reachable (${selfCheck.error})`}
          </span>
        </div>
      )}

      {/* Quick actions */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* OAuth Manifest Flow */}
        <Card className="border-primary/20 hover:border-primary/40 transition-colors cursor-pointer" onClick={handleManifestFlow}>
          <CardHeader className="flex flex-row items-start gap-4 pb-3">
            <div className="rounded-lg bg-primary/10 p-2.5"><GitFork className="size-5 text-primary" /></div>
            <div className="flex-1">
              <CardTitle className="text-base">OAuth — Auto-create GitHub App</CardTitle>
              <CardDescription className="text-sm mt-0.5">
                Redirect to GitHub to create a GitHub App automatically with all required permissions.
                Credentials are stored encrypted in the database.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Button size="sm" disabled={manifestInit.isPending} className="w-full">
              {manifestInit.isPending ? 'Preparing...' : <><ExternalLink className="mr-2 size-4" />Create GitHub App</>}
            </Button>
          </CardContent>
        </Card>

        {/* PAT Flow */}
        <Card className="hover:border-border/80 transition-colors cursor-pointer" onClick={() => setPatOpen(true)}>
          <CardHeader className="flex flex-row items-start gap-4 pb-3">
            <div className="rounded-lg bg-muted p-2.5"><Key className="size-5 text-muted-foreground" /></div>
            <div className="flex-1">
              <CardTitle className="text-base">API Key (PAT)</CardTitle>
              <CardDescription className="text-sm mt-0.5">
                Use a GitHub Personal Access Token. Faster setup but fewer features.
                <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="block text-primary underline mt-1">Create a token on GitHub ↗</a>
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Button size="sm" variant="outline" className="w-full"><Key className="mr-2 size-4" />Add with PAT</Button>
          </CardContent>
        </Card>
      </div>

      {/* Configured apps + Manual entry */}
      <Tabs defaultValue="apps">
        <TabsList><TabsTrigger value="apps">Configured Apps</TabsTrigger><TabsTrigger value="manual">Manual Entry</TabsTrigger></TabsList>

        <TabsContent value="apps" className="mt-4">
          {apps.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <GitFork className="mb-4 size-12 text-muted-foreground/40" />
                <p className="text-lg font-medium">No GitHub Apps configured</p>
                <p className="text-sm text-muted-foreground">Use the OAuth flow above to auto-create one, or enter credentials manually below.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader><CardTitle>Configured Apps</CardTitle><CardDescription>{apps.length} app{apps.length !== 1 ? 's' : ''}</CardDescription></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>App ID</TableHead><TableHead>Client ID</TableHead><TableHead>Status</TableHead><TableHead className="w-20">Actions</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {apps.map((app: { id: string; name: string; appId: string; clientId: string; isActive: boolean }) => (
                      <TableRow key={app.id}>
                        <TableCell className="font-medium">{app.name}</TableCell>
                        <TableCell className="font-mono text-xs">{app.appId}</TableCell>
                        <TableCell className="font-mono text-xs">{app.clientId.slice(0, 12)}...</TableCell>
                        <TableCell><Badge variant={app.isActive ? 'default' : 'secondary'}>{app.isActive ? 'Active' : 'Inactive'}</Badge></TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="size-8" onClick={() => handleDelete(app.id, app.name)} title="Remove"><Trash2 className="size-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="manual" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Manual Entry</CardTitle><CardDescription>Enter your GitHub App credentials manually.
              <a href="https://github.com/settings/apps" target="_blank" rel="noopener noreferrer" className="ml-1 text-primary underline">Create or find your GitHub App ↗</a>
            </CardDescription></CardHeader>
            <CardContent className="max-w-lg space-y-4">
              <createForm.Field name="name">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="name">GitHub App Name</FieldLabel>
                    <FieldDescription>A friendly name to identify this app.</FieldDescription>
                    <Input id="name" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="My GitHub App" />
                  </Field>
                )}
              </createForm.Field>
              <createForm.Field name="appId">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="appId">GitHub App ID</FieldLabel>
                    <FieldDescription>Found in your GitHub App settings page under "App ID".
                      <a href="https://github.com/settings/apps" target="_blank" rel="noopener noreferrer" className="ml-1 text-primary underline">Find it ↗</a>
                    </FieldDescription>
                    <Input id="appId" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="123456" />
                  </Field>
                )}
              </createForm.Field>
              <createForm.Field name="clientId">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="clientId">Client ID</FieldLabel>
                    <FieldDescription>Found in your GitHub App settings under "Client ID".</FieldDescription>
                    <Input id="clientId" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="Iv1.xxxxxxxxxxxx" />
                  </Field>
                )}
              </createForm.Field>
              <createForm.Field name="clientSecret">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="clientSecret">Client Secret</FieldLabel>
                    <FieldDescription>Generate a new client secret in your GitHub App settings. Encrypted at rest.</FieldDescription>
                    <Input id="clientSecret" type="password" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
                  </Field>
                )}
              </createForm.Field>
              <createForm.Field name="privateKey">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="privateKey">Private Key</FieldLabel>
                    <FieldDescription>Generate a private key in your GitHub App settings under "Private keys". Paste the full PEM.</FieldDescription>
                    <textarea id="privateKey" className="flex min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs font-mono" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="-----BEGIN RSA PRIVATE KEY-----" />
                  </Field>
                )}
              </createForm.Field>
              <createForm.Field name="webhookSecret">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="webhookSecret">Webhook Secret</FieldLabel>
                    <FieldDescription>Optional. Configured in your GitHub App settings under "Webhook secret".</FieldDescription>
                    <Input id="webhookSecret" type="password" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
                  </Field>
                )}
              </createForm.Field>
              <createForm.Subscribe selector={(s) => s.canSubmit}>
                {(canSubmit) => (
                  <Button onClick={createForm.handleSubmit} disabled={!canSubmit || createApp.isPending}>
                    {createApp.isPending ? 'Adding...' : 'Add App'}
                  </Button>
                )}
              </createForm.Subscribe>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* PAT Dialog */}
      <Dialog open={patOpen} onOpenChange={setPatOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add with Personal Access Token</DialogTitle>
            <DialogDescription>
              Enter a GitHub PAT with <code>repo</code> scope. Token is stored encrypted.
              <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="ml-1 text-primary underline">Create one ↗</a>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <patForm.Field name="name">
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor="pat-name">Name</Label>
                  <Input id="pat-name" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="My PAT" />
                </div>
              )}
            </patForm.Field>
            <patForm.Field name="pat">
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor="pat-token">Personal Access Token</Label>
                  <Input id="pat-token" type="password" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="ghp_..." />
                  <p className="text-xs text-muted-foreground">Requires <code>repo</code> scope for private repos, <code>public_repo</code> for public.</p>
                </div>
              )}
            </patForm.Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPatOpen(false)}>Cancel</Button>
            <patForm.Subscribe selector={(s) => s.canSubmit}>
              {(canSubmit) => (
                <Button onClick={patForm.handleSubmit} disabled={!canSubmit || createFromPat.isPending}>
                  {createFromPat.isPending ? 'Validating...' : 'Add with PAT'}
                </Button>
              )}
            </patForm.Subscribe>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
