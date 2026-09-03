'use client'

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
import { Field, FieldLabel, FieldDescription } from '@repo/ui/components/shadcn/field'
import { Siren, Plus, Trash2, Container, ArrowLeft, Key, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { AuthDashboardAdminProvidersCode } from '@/routes'
import { z } from 'zod/v4'

const dockerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password or access token is required'),
  registryUrl: z.string().optional().default('https://index.docker.io/v1/'),
})

export default function AdminProvidersCodeDockerHubPage() {
  const [items, setItems] = useState<Array<{ id: string; name: string; username: string; registry: string }>>([])
  const [addOpen, setAddOpen] = useState(false)
  const form = useForm({
    defaultValues: { name: '', username: '', password: '', registryUrl: 'https://index.docker.io/v1/' },
    onSubmit: async ({ value }) => {
      const parsed = dockerSchema.safeParse(value)
      if (!parsed.success) return
      const newItem = { id: `dh-${Date.now()}`, name: parsed.data.name, username: parsed.data.username, registry: parsed.data.registryUrl ?? 'https://index.docker.io/v1/' }
      setItems((prev) => [...prev, newItem])
      toast.success('Docker Hub credentials added')
      setAddOpen(false); form.reset()
    },
  })

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <div className="space-y-6">
      <AuthDashboardAdminProvidersCode.Link><Button variant="ghost" size="sm" className="-ml-2"><ArrowLeft className="mr-1 size-4" />Code Providers</Button></AuthDashboardAdminProvidersCode.Link>
      <div className="flex items-center gap-2">
        <Container className="size-6 text-blue-500" /><div><h1 className="text-2xl font-semibold tracking-tight">Docker Hub</h1><p className="text-sm text-muted-foreground">Configure container registry credentials for image access.</p></div>
      </div>
      <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="mr-2 size-4" />Add Registry Credentials</Button>

      <Card>
        <CardHeader><CardTitle>Registry Credentials</CardTitle><CardDescription>Docker Hub accounts configured for container image access.</CardDescription></CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Container className="mb-4 size-12 text-muted-foreground/40" /><p className="text-lg font-medium">No credentials configured</p>
              <p className="text-sm text-muted-foreground">Add Docker Hub credentials to access private container images.</p>
            </div>
          ) : (
            <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Username</TableHead><TableHead>Registry</TableHead><TableHead>Status</TableHead><TableHead className="w-20">Actions</TableHead></TableRow></TableHeader>
              <TableBody>{items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.name}</TableCell><TableCell>{item.username}</TableCell>
                  <TableCell className="text-xs">{item.registry}</TableCell>
                  <TableCell><Badge variant="default">Active</Badge></TableCell>
                  <TableCell><Button variant="ghost" size="icon" className="size-8" onClick={() => { setDeleteId(item.id); setDeleteName(item.name); setDeleteOpen(true) }}><Trash2 className="size-4" /></Button></TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add Docker Credentials</DialogTitle>
            <DialogDescription>Enter your Docker Hub or registry credentials.
              <a href="https://hub.docker.com/settings/security" target="_blank" rel="noopener noreferrer" className="ml-1 text-primary underline">Create access token ↗</a>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <form.Field name="name">{(f) => <div className="grid gap-2"><Label>Name</Label><Input value={f.state.value as string} onChange={(e) => f.handleChange(e.target.value)} placeholder="My Docker Hub" /></div>}</form.Field>
            <form.Field name="username">{(f) => (<Field><FieldLabel>Username</FieldLabel><FieldDescription>Your Docker Hub username.</FieldDescription><Input value={f.state.value as string} onChange={(e) => f.handleChange(e.target.value)} placeholder="dockeruser" /></Field>)}</form.Field>
            <form.Field name="password">{(f) => (<Field><FieldLabel>Password / Access Token</FieldLabel><FieldDescription>Docker Hub password or personal access token. Encrypted at rest.</FieldDescription><Input type="password" value={f.state.value as string} onChange={(e) => f.handleChange(e.target.value)} placeholder="••••••••" /></Field>)}</form.Field>
            <form.Field name="registryUrl">{(f) => (<Field><FieldLabel>Registry URL</FieldLabel><FieldDescription>Container registry URL. Leave default for Docker Hub.</FieldDescription><Input value={f.state.value as string} onChange={(e) => f.handleChange(e.target.value)} placeholder="https://index.docker.io/v1/" /></Field>)}</form.Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={form.handleSubmit}>Add Credentials</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Remove Credentials</DialogTitle><DialogDescription>Remove these registry credentials?</DialogDescription></DialogHeader>
          <p className="text-sm text-muted-foreground">Remove <strong>{deleteName}</strong>?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { setItems((prev) => prev.filter((i) => i.id !== deleteId)); setDeleteOpen(false); setDeleteId(null); toast.success('Removed') }}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
