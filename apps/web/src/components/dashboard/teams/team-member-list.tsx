'use client'

import type { JSX } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@repo/ui/components/shadcn/avatar'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@repo/ui/components/shadcn/dropdown-menu'
import { MoreHorizontal, Shield, UserX } from 'lucide-react'
import { cn } from '@/lib/utils'

// Team member type based on Better Auth teams
interface TeamMember {
  id: string
  userId: string
  teamId: string
  role: 'owner' | 'member'
  user: {
    name?: string | null
    email: string
    image?: string | null
  }
  createdAt: Date
}

interface TeamMemberItemProps {
  member: TeamMember
  currentUserId?: string
  canManage?: boolean
  onChangeRole?: (memberId: string, newRole: 'owner' | 'member') => void
  onRemove?: (memberId: string) => void
  className?: string
}

export function TeamMemberItem({
  member,
  currentUserId,
  canManage = false,
  onChangeRole,
  onRemove,
  className,
}: TeamMemberItemProps): JSX.Element {
  const isCurrentUser = member.userId === currentUserId
  const initials =
    member.user.name
      ?.split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) ?? member.user.email.slice(0, 2).toUpperCase()

  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-lg border p-3',
        className
      )}
    >
      <div className="flex items-center gap-3">
        <Avatar className="h-9 w-9">
          <AvatarImage
            src={member.user.image ?? undefined}
            alt={member.user.name ?? member.user.email}
          />
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col">
          <span className="text-sm font-medium">
            {member.user.name ?? member.user.email}
            {isCurrentUser && (
              <span className="text-muted-foreground ml-1 text-xs">(you)</span>
            )}
          </span>
          <span className="text-muted-foreground text-xs">{member.user.email}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={member.role === 'owner' ? 'default' : 'outline'}>
          {member.role === 'owner' ? 'Lead' : 'Member'}
        </Badge>
        {canManage && !isCurrentUser && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Member actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {member.role === 'member' && (
                <DropdownMenuItem onClick={() => onChangeRole?.(member.id, 'owner')}>
                  <Shield className="mr-2 h-4 w-4" />
                  Make Lead
                </DropdownMenuItem>
              )}
              {member.role === 'owner' && (
                <DropdownMenuItem onClick={() => onChangeRole?.(member.id, 'member')}>
                  <Shield className="mr-2 h-4 w-4" />
                  Make Member
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onRemove?.(member.id)}
              >
                <UserX className="mr-2 h-4 w-4" />
                Remove from Team
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

interface TeamMemberListProps {
  members: TeamMember[]
  currentUserId?: string
  canManage?: boolean
  isLoading?: boolean
  onChangeRole?: (memberId: string, newRole: 'owner' | 'member') => void
  onRemoveMember?: (memberId: string) => void
  className?: string
}

export function TeamMemberList({
  members,
  currentUserId,
  canManage = false,
  isLoading = false,
  onChangeRole,
  onRemoveMember,
  className,
}: TeamMemberListProps): JSX.Element {
  if (isLoading) {
    return (
      <div className={cn('space-y-2', className)}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-muted/50 h-14 animate-pulse rounded-lg" />
        ))}
      </div>
    )
  }

  if (members.length === 0) {
    return (
      <div className="text-muted-foreground py-6 text-center text-sm">
        No members in this team
      </div>
    )
  }

  // Sort members: leads first, then members
  const sortedMembers = [...members].sort((a, b) => {
    if (a.role === 'owner' && b.role !== 'owner') return -1
    if (a.role !== 'owner' && b.role === 'owner') return 1
    return 0
  })

  return (
    <div className={cn('space-y-2', className)}>
      {sortedMembers.map((member) => (
        <TeamMemberItem
          key={member.id}
          member={member}
          currentUserId={currentUserId}
          canManage={canManage}
          onChangeRole={onChangeRole}
          onRemove={onRemoveMember}
        />
      ))}
    </div>
  )
}

// Export type for external use
export type { TeamMember }
