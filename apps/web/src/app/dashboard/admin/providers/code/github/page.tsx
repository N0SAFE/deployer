'use client'

import { useState } from 'react'
import { GitFork, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { EmptyState, PageHeader, StatusBadge } from '@/components/dashboard'
import { useDeleteGitHubApp, useGitHubApps, useGitHubManifestInit, useGitHubSelfCheck } from '@/domains/github-apps/hooks'
import { getErrorMessage } from '@/lib/orpc/typed-errors'
import { ProviderLoadError, ProviderPageSkeleton } from '../../_components/states'
import { RemoveAccountDialog } from '../../_components/remove-account-dialog'
import { GithubManualDialog } from './_components/github-manual-dialog'
import { GithubPatDialog } from './_components/github-pat-dialog'
import { GithubSetup } from './_components/github-setup'

/**
 * Submits GitHub's manifest to /settings/apps/new in a new tab. The manifest flow
 * requires a POSTed form, not a link, so the form is built and sent by hand.
 */
function postManifest(target: string, manifest: string): void {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = target
  form.target = '_blank'
  form.rel = 'noopener noreferrer'
  const input = document.createElement('input')
  input.type = 'hidden'
  input.name = 'manifest'
  input.value = manifest
  form.appendChild(input)
  document.body.appendChild(form)
  form.submit()
  form.remove()
}

export default function GithubIntegrationPage() {
  const { data, isLoading, error, refetch, isRefetching } = useGitHubApps()
  const selfCheck = useGitHubSelfCheck()
  const deleteApp = useDeleteGitHubApp()
  const manifestInit = useGitHubManifestInit()
  const apps = data?.apps ?? []

  const [patOpen, setPatOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  const check = selfCheck.data
  const blockedReason = check && !check.reachable
    ? `GitHub must reach this API at ${check.publicUrl ?? 'its public URL'}, and it does not answer${check.error ? ` (${check.error})` : ''}. Set up the public edge, or use a token.`
    : null

  const startManifest = async () => {
    try {
      // GitHub redirects the browser to this web-app page (it holds the session
      // cookie); that page then hands the code to the protected API.
      const redirectUrl = `${window.location.origin}/dashboard/admin/providers/code/github/callback`
      const result = await manifestInit.mutateAsync({ redirectUrl })
      postManifest(result.target, result.manifest)
      toast.success('GitHub opened in a new tab', { description: `Confirm “${result.appName}” there; credentials are stored automatically when you come back.` })
    } catch (err) {
      toast.error('Could not start the GitHub App flow', { description: getErrorMessage(err, 'The API refused the request.') })
    }
  }

  const confirmRemove = async () => {
    if (!removing) return
    setRemoveError(null)
    try {
      await deleteApp.mutateAsync({ params: { id: removing.id } })
      toast.success(`GitHub connection “${removing.name}” removed`)
      setRemoving(null)
    } catch (err) {
      setRemoveError(getErrorMessage(err, 'The connection could not be removed.'))
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings › Integrations"
        title="GitHub"
        description="Deploy from your repositories, receive push webhooks and get a preview for each branch or pull request."
      />

      {error ? (
        <ProviderLoadError what="GitHub connections" message={getErrorMessage(error, 'The API did not answer.')} onRetry={() => void refetch()} retrying={isRefetching} />
      ) : isLoading ? (
        <ProviderPageSkeleton />
      ) : (
        <>
          <section className="space-y-3" aria-label={apps.length === 0 ? 'Connect GitHub' : 'Add another connection'}>
            {apps.length === 0 ? <h2 className="text-sm font-semibold">Connect GitHub — pick one way</h2> : <h2 className="text-sm font-semibold">Add another connection</h2>}
            <GithubSetup recommended blockedReason={blockedReason} preparing={manifestInit.isPending} onManifest={() => void startManifest()} onPat={() => { setPatOpen(true); }} onManual={() => { setManualOpen(true); }} />
          </section>

          {apps.length === 0 ? (
            <EmptyState icon={GitFork} title="No GitHub connection yet" description="Once connected, you can pick repositories when you create a service." />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Connections</CardTitle>
                <CardDescription>Credentials are verified when added and again whenever a build uses them.</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead><TableHead>App ID</TableHead><TableHead>Client ID</TableHead><TableHead>Status</TableHead>
                      <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {apps.map((app) => (
                      <TableRow key={app.id}>
                        <TableCell className="font-medium">{app.name}</TableCell>
                        <TableCell className="font-mono text-sm">{app.appId}</TableCell>
                        <TableCell className="font-mono text-sm" title={app.clientId}>{app.clientId.slice(0, 12)}…</TableCell>
                        <TableCell><StatusBadge status={app.isActive ? 'connected' : 'inactive'} className="normal-case">{app.isActive ? 'Configured' : 'Disabled'}</StatusBadge></TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" aria-label={`Remove GitHub connection ${app.name}`} onClick={() => { setRemoveError(null); setRemoving({ id: app.id, name: app.name }) }}>
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <GithubPatDialog open={patOpen} onOpenChange={setPatOpen} />
      <GithubManualDialog open={manualOpen} onOpenChange={setManualOpen} />
      <RemoveAccountDialog
        open={removing !== null}
        onOpenChange={(open) => { if (!open) setRemoving(null) }}
        kind="GitHub connection"
        name={removing?.name ?? ''}
        consequences="Services that deploy from it will fail their next build and previews stop updating until you connect GitHub again. Repositories and the app on GitHub are not touched; delete the app there too if you no longer want it."
        pending={deleteApp.isPending}
        error={removeError}
        onConfirm={() => void confirmRemove()}
      />
    </div>
  )
}
