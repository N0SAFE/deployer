'use client'

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from '@tanstack/react-form'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
import { Siren, Plus, Trash2, Cloud, ArrowLeft, Settings2, ShieldCheck, ShieldAlert, Network, Globe, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { AuthDashboardAdminProvidersDns, AuthDashboardAdminProvidersDnsCloudflareProviderId } from '@/routes'
import { useDNSProviders, useCreateDNSProvider, useUpdateDNSProvider, useDeleteDNSProvider, useCheckProviderState } from '@/domains/dns-providers/hooks'
import { z } from 'zod/v4'

const tokenFormSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  apiToken: z.string().min(1, 'API token is required'),
  accountEmail: z.string().email('Invalid email').optional().or(z.literal('')),
})

interface DnsProviderApp {
  id: string
  name: string
  providerType: string
  isActive: boolean
  features: { dnsManagement: boolean; tunnelManagement: boolean }
  state: {
    status: 'ok' | 'error' | 'unknown'
    checkedAt: string | null
    accountId: string | null
    tokenValid: boolean | null
    error: string | null
  } | null
  createdAt: string
  updatedAt: string
}

export default function AdminDnsProvidersCloudflarePage() {
  const { data, isLoading, error } = useDNSProviders()
  const createProvider = useCreateDNSProvider()
  const updateProvider = useUpdateDNSProvider()
  const deleteProvider = useDeleteDNSProvider()
  const checkState = useCheckProviderState()
  const router = useRouter()

  // CF-3: only Cloudflare apps belong on this page — a route53/google-dns row
  // created through a legacy form must not render as a Cloudflare app.
  const providers = ((data?.providers ?? []) as DnsProviderApp[]).filter(
    (p) => p.providerType === 'cloudflare',
  )

  const [addOpen, setAddOpen] = useState(false)
  const tokenForm = useForm({
    defaultValues: { name: '', apiToken: '', accountEmail: '' },
    onSubmit: async ({ value }) => {
      const parsed = tokenFormSchema.safeParse(value)
      if (!parsed.success) return
      try {
        await createProvider.mutateAsync({
          name: parsed.data.name,
          providerType: 'cloudflare',
          apiToken: parsed.data.apiToken,
          accountEmail: parsed.data.accountEmail || undefined,
          features: { dnsManagement: true, tunnelManagement: false },
        })
        toast.success('Cloudflare app added')
        setAddOpen(false)
        tokenForm.reset()
      } catch (err) {
        toast.error('Failed to add app', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Invalid API token') : UNKNOWN_ORPC_ERROR_MESSAGE })
      }
    },
  })

  // ─── Configure dialog state ────────────────────────────────────────────────
  const [configureId, setConfigureId] = useState<string | null>(null)
  const [configureName, setConfigureName] = useState('')
  const [configureDns, setConfigureDns] = useState(true)
  const [configureTunnel, setConfigureTunnel] = useState(false)
  const [configureActive, setConfigureActive] = useState(true)
  const configureApp = providers.find((p) => p.id === configureId)

  const openConfigure = (app: DnsProviderApp) => {
    setConfigureId(app.id)
    setConfigureName(app.name)
    setConfigureDns(app.features.dnsManagement)
    setConfigureTunnel(app.features.tunnelManagement)
    setConfigureActive(app.isActive)
  }

  const saveConfigure = async () => {
    if (!configureId) return
    try {
      await updateProvider.mutateAsync({
        params: { id: configureId },
        body: {
          name: configureName.trim() || undefined,
          isActive: configureActive,
          features: { dnsManagement: configureDns, tunnelManagement: configureTunnel },
        },
      })
      toast.success('Cloudflare app updated')
      setConfigureId(null)
    } catch (err) {
      toast.error('Failed to update app', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    }
  }

  // ─── Delete dialog state ───────────────────────────────────────────────────
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deleteProvider.mutateAsync({ params: { id: deleteId } })
      toast.success('App removed')
      setDeleteOpen(false)
      setDeleteId(null)
    } catch (err) {
      toast.error('Failed to remove', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    }
  }

  const refreshState = async (id: string) => {
    try {
      await checkState.mutateAsync({ params: { id } })
      toast.success('State re-checked at runtime')
    } catch (err) {
      toast.error('Re-check failed', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    }
  }

  if (isLoading) return <div className="space-y-6"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full rounded-xl" /></div>
  if (error) return <Alert variant="destructive"><Siren className="size-4" /><AlertTitle>Failed to load</AlertTitle><AlertDescription>{isDefinedORPCError(error) ? getErrorMessage(error) : 'An error occurred'}</AlertDescription></Alert>

  const tunnelEnabledApps = providers.filter((p) => p.isActive && p.features.tunnelManagement && p.state?.status === 'ok').length

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <AuthDashboardAdminProvidersDns.Link>
          <Button variant="ghost" size="sm" className="-ml-2"><ArrowLeft className="mr-1 size-4" />DNS Providers</Button>
        </AuthDashboardAdminProvidersDns.Link>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Cloud className="size-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Cloudflare Apps</h1>
            <p className="text-sm text-muted-foreground">
              Each app is one Cloudflare account connection (API token). App state is checked at runtime.
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="mr-2 size-4" />Add Cloudflare App</Button>
      </div>

      {/* Feature availability banner — gating for other modules */}
      <Alert className={tunnelEnabledApps > 0 ? 'border-primary/40 bg-primary/5' : ''}>
        <Network className="size-4" />
        <AlertTitle>Tunnel management {tunnelEnabledApps > 0 ? 'available' : 'not configured'}</AlertTitle>
        <AlertDescription>
          {tunnelEnabledApps > 0
            ? `${tunnelEnabledApps} app${tunnelEnabledApps > 1 ? 's' : ''} can host Cloudflare Tunnels — System → Node Network now offers a Tunnel option instead of a raw IP/domain.`
            : 'Enable "Tunnel management" on an app below to unlock the Tunnel option in System → Node Network. Tunnel health is checked at runtime.'}
        </AlertDescription>
      </Alert>

      {/* Apps grid */}
      {providers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Cloud className="size-10 text-muted-foreground" />
            <div>
              <p className="font-medium">No Cloudflare app yet</p>
              <p className="text-sm text-muted-foreground">
                Add your first API token to manage DNS records and (optionally) host tunnels.
              </p>
            </div>
            <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="mr-2 size-4" />Add Cloudflare App</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {providers.map((app) => (
            <Card
              key={app.id}
              className={[
                'group transition-all',
                app.isActive ? '' : 'opacity-60',
                'hover:border-primary/50 hover:shadow-md hover:ring-1 hover:ring-primary/20',
                'cursor-pointer',
              ].join(' ')}
              role="button"
              tabIndex={0}
              aria-label={`Open ${app.name} configuration`}
              onClick={() =>
                router.push(AuthDashboardAdminProvidersDnsCloudflareProviderId({ providerId: app.id }))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  router.push(AuthDashboardAdminProvidersDnsCloudflareProviderId({ providerId: app.id }))
                }
              }}
            >
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-orange-100 p-2 dark:bg-orange-950/50">
                    <Cloud className="size-5 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{app.name}</CardTitle>
                    <CardDescription className="mt-0.5">
                      {app.state?.status === 'ok'
                        ? app.state.accountId
                          ? `Account ${app.state.accountId.slice(0, 8)}…`
                          : 'Connected'
                        : app.state?.status === 'error'
                          ? 'Connection error'
                          : 'State unknown'}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <StateBadge state={app.state} />
                  <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="gap-1"><Globe className="size-3" /> DNS{app.features.dnsManagement ? '' : ' off'}</Badge>
                  <Badge variant={app.features.tunnelManagement ? 'default' : 'outline'} className="gap-1">
                    <Network className="size-3" /> Tunnel{app.features.tunnelManagement ? '' : ' off'}
                  </Badge>
                  <Badge variant={app.isActive ? 'secondary' : 'destructive'}>{app.isActive ? 'Active' : 'Inactive'}</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation()
                      router.push(AuthDashboardAdminProvidersDnsCloudflareProviderId({ providerId: app.id }))
                    }}
                  >
                    <Globe className="mr-1 size-3.5" />Open configuration
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => { e.stopPropagation(); openConfigure(app) }}
                  >
                    <Settings2 className="mr-1 size-3.5" />Configure
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); refreshState(app.id) }}
                    disabled={checkState.isPending}
                    title="Re-check state at runtime"
                  >
                    <ShieldCheck className="mr-1 size-3.5" />Re-check
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); setDeleteId(app.id); setDeleteName(app.name); setDeleteOpen(true) }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <p className="hidden text-xs text-primary transition-opacity opacity-0 group-hover:opacity-100">
                  Click the card to manage DNS records and tunnels →
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add App Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Cloudflare App</DialogTitle>
            <DialogDescription>
              Enter a Cloudflare API token.{' '}
              <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener noreferrer" className="text-primary underline">Create one ↗</a>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <tokenForm.Field name="name">
                {(field) => (
                  <Input placeholder="My Cloudflare account" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
                )}
              </tokenForm.Field>
            </div>
            <div className="space-y-1.5">
              <Label>API token</Label>
              <tokenForm.Field name="apiToken">
                {(field) => (
                  <Input type="password" placeholder="Cloudflare API token" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
                )}
              </tokenForm.Field>
            </div>
            <div className="space-y-1.5">
              <Label>Account email (optional)</Label>
              <tokenForm.Field name="accountEmail">
                {(field) => (
                  <Input type="email" placeholder="you@example.com" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
                )}
              </tokenForm.Field>
            </div>
            <p className="text-xs text-muted-foreground">
              The token is verified against Cloudflare at runtime before the app is created. DNS management is on by default;
              tunnel management can be enabled from the app configuration afterwards.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={tokenForm.handleSubmit} disabled={createProvider.isPending}>
              {createProvider.isPending ? 'Verifying token…' : 'Add app'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Configure App Dialog */}
      <Dialog open={configureId !== null} onOpenChange={(open) => { if (!open) setConfigureId(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Configure {configureApp?.name ?? ''}</DialogTitle>
            <DialogDescription>Toggle which features this app exposes to the platform.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={configureName} onChange={(e) => setConfigureName(e.target.value)} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">DNS management</p>
                <p className="text-xs text-muted-foreground">Zones, records and domain features use this app.</p>
              </div>
              <Switch checked={configureDns} onCheckedChange={setConfigureDns} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Tunnel management</p>
                <p className="text-xs text-muted-foreground">
                  Lets System → Node Network provision a Cloudflare Tunnel through this app.
                </p>
              </div>
              <Switch checked={configureTunnel} onCheckedChange={setConfigureTunnel} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">App active</p>
                <p className="text-xs text-muted-foreground">Inactive apps cannot be used by other modules.</p>
              </div>
              <Switch checked={configureActive} onCheckedChange={setConfigureActive} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigureId(null)}>Cancel</Button>
            <Button onClick={saveConfigure} disabled={updateProvider.isPending}>
              {updateProvider.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete App Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Remove app</DialogTitle><DialogDescription>Remove the Cloudflare app?</DialogDescription></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Remove <strong>{deleteName}</strong>? Apps backing a node tunnel cannot be removed until the tunnel binding is cleared.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteProvider.isPending}>
              {deleteProvider.isPending ? 'Removing…' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StateBadge({ state }: { state: DnsProviderApp['state'] }) {
  if (state?.status === 'ok') {
    return (
      <Badge variant="default" className="gap-1">
        <ShieldCheck className="size-3" /> Live
      </Badge>
    )
  }
  if (state?.status === 'error') {
    return (
      <Badge variant="destructive" className="gap-1" title={state.error ?? undefined}>
        <ShieldAlert className="size-3" /> Error
      </Badge>
    )
  }
  return <Badge variant="secondary">Unknown</Badge>
}

