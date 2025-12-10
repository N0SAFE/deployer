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
import { MoreHorizontal, Shield, Crown, UserX, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { authClient } from '@/lib/auth'
import { type OrganizationRole, ORGANIZATION_ROLES } from '@repo/auth'

/**
 * Member type inferred from Better Auth client.
 * Includes user data from getFullOrganization.
 */
export type Member = typeof authClient.$Infer.Member

/**
 * Re-export OrganizationRole for components using this module
 */
export type { OrganizationRole }
export { ORGANIZATION_ROLES }

interface MemberAvatarProps {
  user: {
    name?: string | null
    email: string
    image?: string | null
  }
  size?: 'sm' | 'md' | 'lg'
  showRole?: boolean
  role?: OrganizationRole
  className?: string
}

const sizeClasses = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
}

const roleBadgeConfig: Record<
  OrganizationRole,
  { label: string; variant: 'default' | 'secondary' | 'outline'; icon: typeof Crown }
> = {
  owner: { label: 'Owner', variant: 'default', icon: Crown },
  admin: { label: 'Admin', variant: 'secondary', icon: Shield },
  member: { label: 'Member', variant: 'outline', icon: Shield },
}

export function MemberAvatar({
  user,
  size = 'md',
  showRole = false,
  role,
  className,
}: MemberAvatarProps): JSX.Element {
  const initials =
    user.name
      ?.split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) ?? user.email.slice(0, 2).toUpperCase()

  return (
    <div className={cn('relative', className)}>
      <Avatar className={sizeClasses[size]}>
        <AvatarImage src={user.image ?? undefined} alt={user.name ?? user.email} />
        <AvatarFallback className="text-xs font-medium">{initials}</AvatarFallback>
      </Avatar>
      {showRole && role === 'owner' && (
        <Crown className="absolute -right-1 -top-1 h-4 w-4 text-amber-500" />
      )}
    </div>
  )
}

interface MemberItemProps {
  member: Member
  currentUserId?: string
  canManage?: boolean
  onChangeRole?: (memberId: string, newRole: OrganizationRole) => void
  onRemove?: (memberId: string) => void
  className?: string
}

export function MemberItem({
  member,
  currentUserId,
  canManage = false,
  onChangeRole,
  onRemove,
  className,
}: MemberItemProps): JSX.Element {
  const isCurrentUser = member.userId === currentUserId
  const roleConfig = roleBadgeConfig[member.role]

  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-lg border p-3',
        className
      )}
    >
      <div className="flex items-center gap-3">
        <MemberAvatar
          user={member.user}
          size="md"
          showRole={member.role === 'owner'}
        />
        <div className="flex flex-col">
          <span className="font-medium">
            {member.user.name || member.user.email}
            {isCurrentUser && (
              <span className="text-muted-foreground ml-1 text-sm">(you)</span>
            )}
          </span>
          <span className="text-muted-foreground text-sm">{member.user.email}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={roleConfig.variant}>{roleConfig.label}</Badge>
        {canManage && !isCurrentUser && member.role !== 'owner' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Member actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onChangeRole?.(member.id, 'admin')}>
                <Shield className="mr-2 h-4 w-4" />
                Make Admin
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onChangeRole?.(member.id, 'member')}>
                <Settings className="mr-2 h-4 w-4" />
                Make Member
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onRemove?.(member.id)}
              >
                <UserX className="mr-2 h-4 w-4" />
                Remove Member
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

interface MemberListProps {
  members: Member[]
  currentUserId?: string
  canManage?: boolean
  isLoading?: boolean
  onChangeRole?: (memberId: string, newRole: OrganizationRole) => void
  onRemoveMember?: (memberId: string) => void
  className?: string
}

export function MemberList({
  members,
  currentUserId,
  canManage = false,
  isLoading = false,
  onChangeRole,
  onRemoveMember,
  className,
}: MemberListProps): JSX.Element {
  if (isLoading) {
    return (
      <div className={cn('space-y-3', className)}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-muted/50 h-16 animate-pulse rounded-lg" />
        ))}
      </div>
    )
  }

  if (members.length === 0) {
    return (
      <div className="text-muted-foreground py-6 text-center text-sm">
        No members found
      </div>
    )
  }

  return (
    <div className={cn('space-y-2', className)}>
      {members.map((member) => (
        <MemberItem
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
