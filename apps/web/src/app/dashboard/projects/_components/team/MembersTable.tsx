'use client'

import { MailWarning, Trash2, UserPlus, Users } from 'lucide-react'
import { projectRoleSchema } from '@deployer/contracts-entities'
import { Avatar, AvatarFallback } from '@deployer/ui/components/shadcn/avatar'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deployer/ui/components/shadcn/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@deployer/ui/components/shadcn/table'
import { EmptyState } from '@/components/dashboard'
import { memberState, isSoleOwner } from '../../[projectId]/_utils/team'
import { CopyButton } from '../workload/CopyButton'
import { RelativeTime } from '../workload/RelativeTime'
import type { ProjectRole } from './InviteMemberDialog'

export interface Member {
  id: string
  userId: string
  role: ProjectRole
  invitedAt: string
  acceptedAt: string | null
}

/** Members list. Scrolls inside its card at narrow widths; pending is badge text + icon, not colour. */
export function MembersTable({
  members,
  ownerCount,
  updatingUserId,
  onChangeRole,
  onRemove,
  onInvite,
}: {
  members: readonly Member[]
  ownerCount: number
  updatingUserId: string | null
  onChangeRole: (member: Member, role: ProjectRole) => void
  onRemove: (member: Member) => void
  onInvite: () => void
}) {
  if (members.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No collaborators yet"
        description="Only organization admins can reach this project until you invite someone. Invite a teammate and pick the role that fits what they need to do."
        action={{ label: 'Invite member', onClick: onInvite }}
      />
    )
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-20 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => {
            const sole = isSoleOwner(m, ownerCount)
            const pending = memberState(m) === 'pending'
            return (
              <TableRow key={m.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="size-8"><AvatarFallback>{m.userId.charAt(0).toUpperCase()}</AvatarFallback></Avatar>
                    <div className="flex items-center gap-1 font-mono text-sm">
                      <span className="max-w-48 truncate" title={m.userId}>{m.userId}</span>
                      <CopyButton value={m.userId} label="Copy user ID" />
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Select value={m.role} onValueChange={(v) => { onChangeRole(m, projectRoleSchema.parse(v)) }} disabled={sole || updatingUserId === m.userId}>
                    <SelectTrigger className="h-8 w-32" aria-label={`Role of ${m.userId}`} title={sole ? 'The last owner cannot be demoted' : undefined}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {projectRoleSchema.options.map((r) => (<SelectItem key={r} value={r}>{r}</SelectItem>))}
                    </SelectContent>
                  </Select>
                  {sole ? <p className="mt-1 text-sm text-muted-foreground">Last owner — cannot be demoted</p> : null}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={pending ? 'secondary' : 'default'}>
                      {pending ? <MailWarning className="mr-1 size-3.5" aria-hidden /> : null}
                      {pending ? 'Invitation pending' : 'Active'}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {pending ? 'invited ' : 'joined '}<RelativeTime value={pending ? m.invitedAt : m.acceptedAt} />
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => { onRemove(m) }}
                      title={sole ? 'The last owner cannot be removed' : 'Remove from project'}
                      aria-label={`Remove ${m.userId} from project`}
                      disabled={sole}
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
    </div>
  )
}

export function InviteButton({ onClick }: { onClick: () => void }) {
  return <Button size="sm" onClick={onClick}><UserPlus className="mr-2 size-4" />Invite member</Button>
}
