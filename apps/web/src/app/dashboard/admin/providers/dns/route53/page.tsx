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
import { Siren, Plus, Trash2, Globe, ArrowLeft, Key } from 'lucide-react'
import { toast } from 'sonner'
import { AuthDashboardAdminProvidersDns } from '@/routes'
import { useDNSProviders, useCreateDNSProvider, useDeleteDNSProvider } from '@/domains/dns-providers/hooks'
import { z } from 'zod/v4'

const route53Schema = z.object({
  name: z.string().min(1, 'Name is required'),
  accessKeyId: z.string().min(1, 'Access Key ID is required'),
  secretAccessKey: z.string().min(1, 'Secret Access Key is required'),
  region: z.string().min(1, 'Region is required').default('us-east-1'),
})

export default function AdminDnsProvidersRoute53Page() {
  const { data, isLoading, error, refetch } = useDNSProviders()
  const createProvider = useCreateDNSProvider()
  const deleteProvider = useDeleteDNSProvider()
  const providers = data?.providers ?? []

  const [addOpen, setAddOpen] = useState(false)
  const form = useForm({
    defaultValues: { name: '', accessKeyId: '', secretAccessKey: '', region: 'us-east-1' },
    onSubmit: async ({ value }) => {
      const parsed = route53Schema.safeParse(value)
      if (!parsed.success) return
      try {
        await createProvider.mutateAsync({ name: parsed.data.name, providerType: 'route53', apiToken: `${parsed.data.accessKeyId}:${parsed.data.secretAccessKey}`, accountEmail: parsed.data.region })
        toast.success('Route53 provider added'); setAddOpen(false); form.reset(); refetch()
      } catch (err) {
        toast.error('Failed to add Route53 provider', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Invalid credentials') : UNKNOWN_ORPC_ERROR_MESSAGE })
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
      <div className="flex items-center gap-3">
        <AuthDashboardAdminProvidersDns.Link><Button variant="ghost" size="sm" className="-ml-2"><ArrowLeft className="mr-1 size-4" />DNS Providers</Button></AuthDashboardAdminProvidersDns.Link>
      </div>
      <div className="flex items-center gap-2">
        <Globe className="size-6 text-amber-500" /><div><h1 className="text-2xl font-semibold tracking-tight">AWS Route53</h1><p className="text-sm text-muted-foreground">Configure AWS access keys for Route53 DNS management.</p></div>
      </div>
      <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="mr-2 size-4" />Add Access Key</Button>

      <Card>
        <CardHeader><CardTitle>Access Keys</CardTitle><CardDescription>Configured AWS IAM access keys for Route53.</CardDescription></CardHeader>
        <CardContent>
          {providers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Globe className="mb-4 size-12 text-muted-foreground/40" /><p className="text-lg font-medium">No access keys configured</p>
              <p className="text-sm text-muted-foreground">Add an AWS access key to manage Route53 DNS records.</p>
            </div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Key ID</TableHead><TableHead>Region</TableHead><TableHead>Status</TableHead><TableHead className="w-20">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {providers.map((p: { id: string; name: string; isActive: boolean }) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.name}</TableCell><TableCell className="font-mono text-xs">••••••••</TableCell>
                    <TableCell className="text-xs">-</TableCell>
                    <TableCell><Badge variant={p.isActive ? 'default' : 'secondary'}>{p.isActive ? 'Active' : 'Inactive'}</Badge></TableCell>
                    <TableCell><Button variant="ghost" size="icon" className="size-8" onClick={() => { setDeleteId(p.id); setDeleteName(p.name); setDeleteOpen(true) }}><Trash2 className="size-4" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add Route53 Access Key</DialogTitle>
            <DialogDescription>Enter your AWS IAM access key.
              <a href="https://console.aws.amazon.com/iam/" target="_blank" rel="noopener noreferrer" className="ml-1 text-primary underline">Create in AWS ↗</a>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <form.Field name="name">{(f) => <div className="grid gap-2"><Label>Name</Label><Input value={f.state.value as string} onChange={(e) => f.handleChange(e.target.value)} placeholder="My AWS Account" /></div>}</form.Field>
            <form.Field name="accessKeyId">{(f) => (<Field><FieldLabel>Access Key ID</FieldLabel><FieldDescription>From your IAM user security credentials.</FieldDescription><Input value={f.state.value as string} onChange={(e) => f.handleChange(e.target.value)} placeholder="AKIAIOSFODNN7EXAMPLE" /></Field>)}</form.Field>
            <form.Field name="secretAccessKey">{(f) => (<Field><FieldLabel>Secret Access Key</FieldLabel><FieldDescription>Encrypted at rest.</FieldDescription><Input type="password" value={f.state.value as string} onChange={(e) => f.handleChange(e.target.value)} placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" /></Field>)}</form.Field>
            <form.Field name="region">{(f) => <div className="grid gap-2"><Label>Default Region</Label><Input value={f.state.value as string} onChange={(e) => f.handleChange(e.target.value)} placeholder="us-east-1" /><p className="text-xs text-muted-foreground">AWS region where your Route53 zones are hosted.</p></div>}</form.Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={form.handleSubmit} disabled={createProvider.isPending}>{createProvider.isPending ? 'Adding...' : 'Add Key'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Remove Access Key</DialogTitle><DialogDescription>Remove this Route53 access key?</DialogDescription></DialogHeader>
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
