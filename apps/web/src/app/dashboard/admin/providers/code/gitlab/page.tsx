'use client'

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage, isDomainError } from "@/lib/orpc/typed-errors";
import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
import { Field, FieldLabel, FieldDescription, FieldError } from '@repo/ui/components/shadcn/field'
import { Siren, Plus, Trash2, Code2, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { AuthDashboardAdminProvidersCode } from '@/routes'
import { useGitlabApps, useCreateGitlabApp, useDeleteGitlabApp } from '@/domains/gitlab/hooks'
import { z } from 'zod/v4'

const gitlabSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  url: z.string().min(1, 'GitLab URL is required').url('Must be a valid URL'),
  accessToken: z.string().min(1, 'Access token is required'),
})

export default function AdminProvidersCodeGitlabPage() {
  const { data, isLoading, error, refetch } = useGitlabApps()
  const createApp = useCreateGitlabApp()
  const deleteApp = useDeleteGitlabApp()

  const apps = data?.apps ?? []

  const [addOpen, setAddOpen] = useState(false)
  const form = useForm({
    defaultValues: { name: '', url: '', accessToken: '' },
    onSubmit: async ({ value }) => {
      const parsed = gitlabSchema.safeParse(value)
      if (!parsed.success) return
      try {
        await createApp.mutateAsync(parsed.data)
        toast.success('GitLab integration added')
        setAddOpen(false)
        form.reset()
        await refetch()
      } catch (err) {
        toast.error("Failed to add GitLab account", {
          description: isDomainError(err, "CONFLICT")
            ? "A GitLab account with this name already exists."
            : getErrorMessage(err, "Unknown error"),
        })
      }
    },
  })

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)

  const confirmDelete = async () => {
    if (!deleteId) return
    try {
      await deleteApp.mutateAsync({ params: { id: deleteId } })
      toast.success('GitLab account removed')
      setDeleteOpen(false)
      setDeleteId(null)
      await refetch()
    } catch (err) {
      toast.error('Failed to remove GitLab account', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    }
  }

  return (
    <div className="space-y-6">
      <AuthDashboardAdminProvidersCode.Link><Button variant="ghost" size="sm" className="-ml-2"><ArrowLeft className="mr-1 size-4" />Code Providers</Button></AuthDashboardAdminProvidersCode.Link>
      <div className="flex items-center gap-2">
        <Code2 className="size-6 text-orange-500" /><div><h1 className="text-2xl font-semibold tracking-tight">GitLab</h1><p className="text-sm text-muted-foreground">Connect GitLab repositories for CI/CD integration.</p></div>
      </div>
      <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="mr-2 size-4" />Add GitLab Account</Button>

      {error ? (
        <Alert variant="destructive"><Siren className="size-4" /><AlertTitle>Failed to load GitLab accounts</AlertTitle><AlertDescription>{isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown error'}</AlertDescription></Alert>
      ) : isLoading ? (
        <div className="space-y-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
      ) : (
        <Card>
          <CardHeader><CardTitle>Connected Accounts</CardTitle><CardDescription>GitLab accounts configured for repository access.</CardDescription></CardHeader>
          <CardContent>
            {apps.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Code2 className="mb-4 size-12 text-muted-foreground/40" /><p className="text-lg font-medium">No accounts configured</p>
                <p className="text-sm text-muted-foreground">Add a GitLab personal access token to access repositories.</p>
              </div>
            ) : (
              <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>URL</TableHead><TableHead>Status</TableHead><TableHead className="w-20">Actions</TableHead></TableRow></TableHeader>
                <TableBody>{apps.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell><TableCell className="text-xs">{item.url}</TableCell>
                    <TableCell><Badge variant="default">Active</Badge></TableCell>
                    <TableCell><Button variant="ghost" size="icon" className="size-8" onClick={() => { setDeleteId(item.id); setDeleteName(item.name); setDeleteOpen(true) }}><Trash2 className="size-4" /></Button></TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add GitLab Account</DialogTitle>
            <DialogDescription>Enter your GitLab instance URL and a personal access token.
              <a href="https://gitlab.com/-/user_settings/personal_access_tokens" target="_blank" rel="noopener noreferrer" className="ml-1 text-primary underline">Create token ↗</a>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <form.Field name="name">{(f) => <div className="grid gap-2"><Label>Name</Label><Input value={f.state.value as string} onChange={(e) => f.handleChange(e.target.value)} placeholder="My GitLab Account" /></div>}</form.Field>
            <form.Field name="url">{(f) => (<Field><FieldLabel>GitLab URL</FieldLabel><FieldDescription>Your GitLab instance URL (e.g., https://gitlab.com).</FieldDescription><Input value={f.state.value as string} onChange={(e) => f.handleChange(e.target.value)} placeholder="https://gitlab.com" />{f.state.meta.errors?.length ? <FieldError>{f.state.meta.errors.join(', ')}</FieldError> : null}</Field>)}</form.Field>
            <form.Field name="accessToken">{(f) => (<Field><FieldLabel>Personal Access Token</FieldLabel><FieldDescription>Token with api and read_repository scopes. Encrypted at rest.</FieldDescription><Input type="password" value={f.state.value as string} onChange={(e) => f.handleChange(e.target.value)} placeholder="glpat-..." /></Field>)}</form.Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={form.handleSubmit} disabled={createApp.isPending}>{createApp.isPending ? 'Adding...' : 'Add Account'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Remove Account</DialogTitle><DialogDescription>Remove this GitLab account?</DialogDescription></DialogHeader>
          <p className="text-sm text-muted-foreground">Remove <strong>{deleteName}</strong>?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleteApp.isPending}>{deleteApp.isPending ? 'Removing...' : 'Remove'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
