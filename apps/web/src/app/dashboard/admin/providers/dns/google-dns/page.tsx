'use client'

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useState, useCallback } from 'react'
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
import { Field, FieldLabel, FieldDescription } from '@repo/ui/components/shadcn/field'
import { Siren, Plus, Trash2, Shield, ArrowLeft, Key } from 'lucide-react'
import { toast } from 'sonner'
import { AuthDashboardAdminProvidersDns } from '@/routes'
import { useDNSProviders, useCreateDNSProvider, useDeleteDNSProvider } from '@/domains/dns-providers/hooks'
import { z } from 'zod/v4'

const googleDnsSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  projectId: z.string().min(1, 'GCP Project ID is required'),
  managedZone: z.string().min(1, 'Managed zone name is required'),
  serviceAccountKey: z.string().min(1, 'Service account key JSON is required'),
})

export default function AdminDnsProvidersGoogleDnsPage() {
  const { data, isLoading, error, refetch } = useDNSProviders()
  const createProvider = useCreateDNSProvider()
  const deleteProvider = useDeleteDNSProvider()
  const providers = data?.providers ?? []

  const [addOpen, setAddOpen] = useState(false)
  const form = useForm({
    defaultValues: { name: '', projectId: '', managedZone: '', serviceAccountKey: '' },
    onSubmit: async ({ value }) => {
      const parsed = googleDnsSchema.safeParse(value)
      if (!parsed.success) return
      try {
        await createProvider.mutateAsync({ name: parsed.data.name, providerType: 'google-dns', apiToken: parsed.data.serviceAccountKey, accountEmail: `${parsed.data.projectId}|${parsed.data.managedZone}` })
        toast.success('Google Cloud DNS provider added'); setAddOpen(false); form.reset(); refetch()
      } catch (err) {
        toast.error('Failed to add provider', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Invalid key') : UNKNOWN_ORPC_ERROR_MESSAGE })
      }
    },
  })

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const handleDelete = useCallback(async () => {
    if (!deleteId) return
    try { await deleteProvider.mutateAsync({ params: { id: deleteId } }); toast.success('Removed'); setDeleteOpen(false); setDeleteId(null); refetch() }
    catch (err) { toast.error('Failed to remove', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE }) }
  }, [deleteId, deleteProvider, refetch])

  if (isLoading) return <div className="space-y-6"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full rounded-xl" /></div>
  if (error) return <Alert variant="destructive"><Siren className="size-4" /><AlertTitle>Failed to load</AlertTitle><AlertDescription>{isDefinedORPCError(error) ? getErrorMessage(error) : 'An error occurred'}</AlertDescription></Alert>

  return (
    <div className="space-y-6">
      <AuthDashboardAdminProvidersDns.Link><Button variant="ghost" size="sm" className="-ml-2"><ArrowLeft className="mr-1 size-4" />DNS Providers</Button></AuthDashboardAdminProvidersDns.Link>
      <div className="flex items-center gap-2">
        <Shield className="size-6 text-blue-500" /><div><h1 className="text-2xl font-semibold tracking-tight">Google Cloud DNS</h1><p className="text-sm text-muted-foreground">Configure service account keys for Google Cloud DNS.</p></div>
      </div>
      <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="mr-2 size-4" />Add Service Account</Button>

      <Card>
        <CardHeader><CardTitle>Service Accounts</CardTitle><CardDescription>Configured GCP service account keys for Cloud DNS.</CardDescription></CardHeader>
        <CardContent>
          {providers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Shield className="mb-4 size-12 text-muted-foreground/40" /><p className="text-lg font-medium">No service accounts configured</p>
              <p className="text-sm text-muted-foreground">Add a GCP service account key to manage Cloud DNS records.</p>
            </div>
          ) : (
            <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Project</TableHead><TableHead>Zone</TableHead><TableHead>Status</TableHead><TableHead className="w-20">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {providers.map((p: { id: string; name: string; isActive: boolean; accountEmail?: string }) => {
                  const meta = (p.accountEmail ?? '').split('|')
                  return (<TableRow key={p.id}>
                    <TableCell>{p.name}</TableCell><TableCell className="text-xs font-mono">{meta[0] ?? '-'}</TableCell>
                    <TableCell className="text-xs">{meta[1] ?? '-'}</TableCell>
                    <TableCell><Badge variant={p.isActive ? 'default' : 'secondary'}>{p.isActive ? 'Active' : 'Inactive'}</Badge></TableCell>
                    <TableCell><Button variant="ghost" size="icon" className="size-8" onClick={() => { setDeleteId(p.id); setDeleteName(p.name); setDeleteOpen(true) }}><Trash2 className="size-4" /></Button></TableCell>
                  </TableRow>)
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add Google Cloud Service Account</DialogTitle>
            <DialogDescription>Enter your GCP service account key JSON.
              <a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" rel="noopener noreferrer" className="ml-1 text-primary underline">Create in GCP ↗</a>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <form.Field name="name">{(f) => <div className="grid gap-2"><Label>Name</Label><Input value={f.state.value as string} onChange={(e) => f.handleChange(e.target.value)} placeholder="My GCP Service Account" /></div>}</form.Field>
            <form.Field name="projectId">{(f) => (<Field><FieldLabel>GCP Project ID</FieldLabel><FieldDescription>Your Google Cloud project ID.</FieldDescription><Input value={f.state.value as string} onChange={(e) => f.handleChange(e.target.value)} placeholder="my-project-123" /></Field>)}</form.Field>
            <form.Field name="managedZone">{(f) => (<Field><FieldLabel>Managed Zone Name</FieldLabel><FieldDescription>Name of the DNS managed zone in Cloud DNS.</FieldDescription><Input value={f.state.value as string} onChange={(e) => f.handleChange(e.target.value)} placeholder="my-zone" /></Field>)}</form.Field>
            <form.Field name="serviceAccountKey">{(f) => (<Field><FieldLabel>Service Account Key (JSON)</FieldLabel><FieldDescription>Full content of the service account key JSON file. Encrypted at rest.</FieldDescription><textarea className="flex min-h-[100px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs font-mono" value={f.state.value as string} onChange={(e) => f.handleChange(e.target.value)} placeholder='{"type": "service_account", ...}' /></Field>)}</form.Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={form.handleSubmit} disabled={createProvider.isPending}>{createProvider.isPending ? 'Adding...' : 'Add Key'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Remove Service Account</DialogTitle><DialogDescription>Remove this GCP service account key?</DialogDescription></DialogHeader>
          <p className="text-sm text-muted-foreground">Remove <strong>{deleteName}</strong>?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteProvider.isPending}>{deleteProvider.isPending ? 'Removing...' : 'Remove'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
