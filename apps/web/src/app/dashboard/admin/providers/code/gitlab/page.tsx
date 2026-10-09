'use client'

import { useState } from 'react'
import { Code2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod/v4'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { EmptyState, PageHeader, StatusBadge } from '@/components/dashboard'
import { useCreateGitlabApp, useDeleteGitlabApp, useGitlabApps } from '@/domains/gitlab/hooks'
import { getErrorMessage, isDomainError } from '@/lib/orpc/typed-errors'
import { FieldHelp } from '../../_components/field-help'
import { RemoveAccountDialog } from '../../_components/remove-account-dialog'
import { ProviderLoadError, ProviderPageSkeleton } from '../../_components/states'
import { TextField } from '../../_components/text-field'
import { useSimpleForm } from '../../_lib/use-simple-form'

const gitlabSchema = z.object({
  name: z.string().trim().min(1, 'Give this account a name'),
  url: z.url('Must be a full URL, e.g. https://gitlab.com'),
  accessToken: z.string().min(1, 'Paste a personal access token'),
})

export default function GitlabIntegrationPage() {
  const { data, isLoading, error, refetch, isRefetching } = useGitlabApps()
  const createApp = useCreateGitlabApp()
  const deleteApp = useDeleteGitlabApp()
  const apps = data?.apps ?? []

  const [addOpen, setAddOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const form = useSimpleForm(gitlabSchema, { name: '', url: 'https://gitlab.com', accessToken: '' })

  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  const submit = async () => {
    if (!form.validate()) return
    setFormError(null)
    try {
      await createApp.mutateAsync({ name: form.values.name.trim(), url: form.values.url.trim(), accessToken: form.values.accessToken })
      toast.success('GitLab account connected')
      setAddOpen(false)
      form.reset()
    } catch (err) {
      setFormError(
        isDomainError(err, 'CONFLICT') ? 'A GitLab account with this name already exists. Choose another name.' : getErrorMessage(err, 'GitLab rejected the URL or token.'),
      )
    }
  }

  const confirmRemove = async () => {
    if (!removeTarget) return
    setRemoveError(null)
    try {
      await deleteApp.mutateAsync({ params: { id: removeTarget.id } })
      toast.success(`GitLab account “${removeTarget.name}” removed`)
      setRemoveTarget(null)
    } catch (err) {
      setRemoveError(getErrorMessage(err, 'The account could not be removed.'))
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings › Integrations"
        title="GitLab"
        description="Deploy services from GitLab.com or a self-hosted GitLab. An account is an instance URL plus an access token; the token is encrypted at rest."
        actions={
          apps.length > 0 ? (
            <Button size="sm" onClick={() => { setAddOpen(true); }}>
              <Plus className="mr-2 size-4" />
              Add GitLab account
            </Button>
          ) : null
        }
      />

      {error ? (
        <ProviderLoadError what="GitLab accounts" message={getErrorMessage(error, 'The API did not answer.')} onRetry={() => void refetch()} retrying={isRefetching} />
      ) : isLoading ? (
        <ProviderPageSkeleton />
      ) : apps.length === 0 ? (
        <EmptyState
          icon={Code2}
          title="No GitLab account connected"
          description="Connect one to pick repositories when you create a service. You will need a personal access token with the api and read_repository scopes."
          action={{ label: 'Connect GitLab', onClick: () => { setAddOpen(true); } }}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Connected accounts</CardTitle>
            <CardDescription>Tokens are verified by GitLab when added and again whenever a deploy uses them.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Instance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apps.map((app) => (
                  <TableRow key={app.id}>
                    <TableCell className="font-medium">{app.name}</TableCell>
                    <TableCell className="font-mono text-sm">{app.url}</TableCell>
                    <TableCell>
                      <StatusBadge status={app.isActive ? 'connected' : 'inactive'} className="normal-case">
                        {app.isActive ? 'Configured' : 'Disabled'}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive"
                        aria-label={`Remove GitLab account ${app.name}`}
                        onClick={() => {
                          setRemoveError(null)
                          setRemoveTarget({ id: app.id, name: app.name })
                        }}
                      >
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

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open)
          if (!open) setFormError(null)
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect a GitLab account</DialogTitle>
            <DialogDescription>GitLab verifies the token when you connect; a wrong URL or token is reported here, nothing is saved.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <FieldHelp href="https://gitlab.com/-/user_settings/personal_access_tokens" linkLabel="Create a token on GitLab">
              <p>
                Choose the scopes <code className="font-mono">api</code> and <code className="font-mono">read_repository</code>. On a self-hosted
                GitLab, open <em>Preferences → Access tokens</em> on your instance instead.
              </p>
            </FieldHelp>
            <TextField id="gl-name" label="Account name" value={form.values.name} onChange={(v) => { form.setValue('name', v); }} onBlur={() => { form.touch('name'); }} error={form.errorFor('name')} placeholder="Company GitLab" />
            <TextField id="gl-url" label="GitLab URL" mono help="Your instance address, without a path." value={form.values.url} onChange={(v) => { form.setValue('url', v); }} onBlur={() => { form.touch('url'); }} error={form.errorFor('url')} placeholder="https://gitlab.com" />
            <TextField id="gl-token" label="Personal access token" secret help="Starts with glpat-. Encrypted at rest; you will not be able to read it back." value={form.values.accessToken} onChange={(v) => { form.setValue('accessToken', v); }} onBlur={() => { form.touch('accessToken'); }} error={form.errorFor('accessToken')} placeholder="glpat-…" />
            {formError ? (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {formError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddOpen(false); }}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={createApp.isPending}>
              {createApp.isPending ? 'Verifying with GitLab…' : 'Connect account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RemoveAccountDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null)
        }}
        kind="GitLab account"
        name={removeTarget?.name ?? ''}
        consequences="Services that deploy from this account will fail their next build until you connect another one. Repositories on GitLab are not touched."
        pending={deleteApp.isPending}
        error={removeError}
        onConfirm={() => void confirmRemove()}
      />
    </div>
  )
}
