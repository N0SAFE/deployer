'use client'

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useParams } from 'next/navigation'
import { useProjectCollaborators, useInviteProjectCollaborator, useUpdateProjectCollaborator, useRemoveProjectCollaborator } from '@/domains/project/hooks'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Avatar, AvatarFallback, AvatarImage } from '@repo/ui/components/shadcn/avatar'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@repo/ui/components/shadcn/dialog'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Siren, Users, UserPlus, Trash2, MailWarning, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod/v4'


const inviteSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  role: z.enum(['owner', 'maintainer', 'deployer', 'viewer']),
})

const ROLE_DESCRIPTIONS: Record<string, string> = {
  owner: 'Full control — manage settings, members, and deployments.',
  maintainer: 'Manage services, environments, and deployments.',
  deployer: 'Trigger and manage deployments.',
  viewer: 'Read-only access.',
}

const ROLE_OPTIONS = ['owner', 'maintainer', 'deployer', 'viewer'] as const

export default function ProjectTeamPage() {
  const params = useParams<{ projectId: string }>()
  const projectId = params.projectId ?? ''

  const { data: collaborators, isLoading, error } = useProjectCollaborators(projectId)
  const inviteMutation = useInviteProjectCollaborator()
  const updateMutation = useUpdateProjectCollaborator()
  const removeMutation = useRemoveProjectCollaborator()

  // ── Invite dialog state ────────────────────────────────────────
  const [inviteOpen, setInviteOpen] = useState(false)

  // ── Remove confirmation state ──────────────────────────────────
  const [removeOpen, setRemoveOpen] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [removingName, setRemovingName] = useState('')

  const inviteForm = useForm({
    defaultValues: { email: '', role: 'viewer' },
    onSubmit: async ({ value }) => {
      const parsed = inviteSchema.safeParse(value)
      if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? 'Invalid input'); return }
      try {
        await inviteMutation.mutateAsync({ params: { id: projectId }, body: { email: parsed.data.email.trim(), role: parsed.data.role as any } })
        toast.success('Invitation sent')
        setInviteOpen(false)
        inviteForm.reset()
      } catch (err) { toast.error('Failed to invite', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE }) }
    },
  })

  const handleUpdateRole = async (userId: string, newRole: string) => {
    try {
      await updateMutation.mutateAsync({ params: { id: projectId, userId }, body: { role: newRole as any } })
      toast.success('Role updated')
    } catch (err) { toast.error('Failed to update role', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE }) }
  }

  const handleRemove = async () => {
    if (!removingId) return
    try {
      await removeMutation.mutateAsync({ params: { id: projectId, userId: removingId } })
      toast.success('Collaborator removed')
      setRemoveOpen(false); setRemovingId(null)
    } catch (err) { toast.error('Failed to remove collaborator', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE }) }
  }

  const confirmRemove = (id: string, name: string) => {
    setRemovingId(id); setRemovingName(name); setRemoveOpen(true)
  }

  // ── Render ─────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card><CardHeader><Skeleton className="h-6 w-32" /><Skeleton className="h-4 w-48" /></CardHeader><CardContent>
        <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="size-10 rounded-full" />
            <div className="space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-24" /></div>
          </div>
        ))}</div>
      </CardContent></Card>
    )
  }

  if (error) {
    return (<Alert variant="destructive"><Siren className="size-4" /><AlertTitle>Failed to load team</AlertTitle><AlertDescription>{isDefinedORPCError(error) ? getErrorMessage(error) : 'An unexpected error.'}</AlertDescription></Alert>)
  }

  const collaboratorList = Array.isArray(collaborators) ? collaborators : (collaborators as any)?.data ?? []

  // Sole-owner guard: the last remaining owner cannot be demoted or removed.
  const ownerCount = collaboratorList.filter((c: any) => (c.role ?? c.roleId) === 'owner').length

  const handleResend = async (c: any) => {
    const email = c.email ?? c.user?.email
    if (!email) return
    try {
      await inviteMutation.mutateAsync({ params: { id: projectId }, body: { email, role: (c.role ?? 'viewer') as any } })
      toast.success('Invitation resent')
    } catch (err) { toast.error('Failed to resend', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE }) }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Team</CardTitle>
              <CardDescription>{collaboratorList.length} member{collaboratorList.length !== 1 ? 's' : ''}</CardDescription>
            </div>
            <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><UserPlus className="mr-2 size-4" />Invite</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader><DialogTitle>Invite Member</DialogTitle><DialogDescription>Send an invitation to join this project.</DialogDescription></DialogHeader>
                <div className="grid gap-4 py-4">
                  <inviteForm.Field name="email">
                    {(field) => (
                      <div className="grid gap-2">
                        <Label>Email</Label>
                        <Input type="email" placeholder="colleague@example.com" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
                      </div>
                    )}
                  </inviteForm.Field>
                  <inviteForm.Field name="role">
                    {(field) => (
                      <div className="grid gap-2">
                        <Label>Role</Label>
                        <Select value={field.state.value} onValueChange={(v) => field.handleChange(v as 'owner' | 'maintainer' | 'deployer' | 'viewer')}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.map((r) => (
                              <SelectItem key={r} value={r}>{r}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[field.state.value]}</p>
                      </div>
                    )}
                  </inviteForm.Field>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
                  <inviteForm.Subscribe selector={(s) => s.isSubmitting}>
                    {(isSubmitting) => (
                      <Button onClick={inviteForm.handleSubmit} disabled={isSubmitting || inviteMutation.isPending}>
                        {inviteMutation.isPending ? 'Sending...' : 'Invite'}
                      </Button>
                    )}
                  </inviteForm.Subscribe>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {collaboratorList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Users className="mb-4 size-12 text-muted-foreground/40" />
              <p className="text-lg font-medium">No collaborators yet</p>
              <p className="text-sm text-muted-foreground">Invite team members to collaborate.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {collaboratorList.map((c: any, i: number) => {
                  const name = c.name ?? c.user?.name ?? c.email ?? 'Unknown'
                  const email = c.email ?? c.user?.email ?? ''
                  const role = c.role ?? c.roleId ?? 'viewer'
                  const status = c.status ?? c.invitationStatus ?? 'active'
                  const isSoleOwner = role === 'owner' && ownerCount <= 1
                  const isPending = status === 'pending' || status === 'invited'
                  return (
                    <TableRow key={c.id ?? i}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="size-8">
                            {c.avatarUrl || c.user?.avatarUrl ? <AvatarImage src={c.avatarUrl ?? c.user?.avatarUrl} alt={name} /> : null}
                            <AvatarFallback>{name.charAt(0).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div><p className="text-sm font-medium">{name}</p>{email && <p className="text-xs text-muted-foreground">{email}</p>}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select value={role} onValueChange={(v) => handleUpdateRole(c.userId ?? c.user?.id ?? c.id, v)} disabled={isSoleOwner}>
                          <SelectTrigger className="h-8 w-28" title={isSoleOwner ? 'The last owner cannot be demoted' : undefined}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.map((r) => (
                              <SelectItem key={r} value={r}>{r}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {isSoleOwner ? <p className="mt-1 text-[10px] text-muted-foreground">Last owner — cannot demote</p> : null}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Badge variant={isPending ? 'secondary' as const : 'default' as const}>{status}</Badge>
                          {isPending ? <MailWarning className="size-3.5 text-muted-foreground" /> : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {isPending ? (
                            <Button variant="ghost" size="icon" className="size-8" onClick={() => handleResend(c)} title="Resend invitation" aria-label={`Resend invitation to ${name}`}>
                              <RotateCcw className="size-4" />
                            </Button>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => confirmRemove(c.id ?? c.userId ?? c.user?.id, name)}
                            title={isSoleOwner ? 'The last owner cannot be removed' : 'Remove'}
                            aria-label={`Remove ${name}`}
                            disabled={isSoleOwner}
                          >
                            <Trash2 className="size-4" />
                          </Button>
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

      {/* Remove Confirmation Dialog */}
      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Remove Collaborator</DialogTitle><DialogDescription>Are you sure? This will revoke access immediately.</DialogDescription></DialogHeader>
          <p className="text-sm">Remove <strong>{removingName}</strong> from this project?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleRemove} disabled={removeMutation.isPending}>{removeMutation.isPending ? 'Removing...' : 'Remove'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
