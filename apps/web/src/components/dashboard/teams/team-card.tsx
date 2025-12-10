'use client'

import type { JSX } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Avatar, AvatarFallback } from '@repo/ui/components/shadcn/avatar'
import { Button } from '@repo/ui/components/shadcn/button'
import {
  Users,
  FolderKanban,
  MoreHorizontal,
  Settings,
  Trash2,
  UserPlus,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@repo/ui/components/shadcn/dropdown-menu'
import { cn } from '@/lib/utils'

// Team type based on Better Auth teams
interface Team {
  id: string
  name: string
  organizationId: string
  createdAt: Date
}

interface TeamCardProps {
  team: Team & {
    _count?: {
      members?: number
      projects?: number
    }
  }
  isActive?: boolean
  userRole?: 'lead' | 'member'
  onSelect?: (team: Team) => void
  onSettings?: (team: Team) => void
  onAddMember?: (team: Team) => void
  onDelete?: (team: Team) => void
  className?: string
}

export function TeamCard({
  team,
  isActive = false,
  userRole,
  onSelect,
  onSettings,
  onAddMember,
  onDelete,
  className,
}: TeamCardProps): JSX.Element {
  const initials = team.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  const canManage = userRole === 'lead'

  return (
    <Card
      className={cn(
        'relative transition-all hover:shadow-md',
        isActive && 'ring-primary ring-2',
        onSelect && 'cursor-pointer',
        className
      )}
      onClick={() => onSelect?.(team)}
    >
      {isActive && (
        <Badge
          variant="default"
          className="bg-primary absolute -top-2 right-3 text-xs"
        >
          Active
        </Badge>
      )}
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="flex items-center gap-3">
          <Avatar className="bg-secondary h-10 w-10">
            <AvatarFallback className="bg-primary/10 text-primary font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              {team.name}
              {userRole === 'lead' && (
                <Badge variant="secondary" className="text-xs">
                  Lead
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="text-muted-foreground text-xs">
              Created {new Date(team.createdAt).toLocaleDateString()}
            </CardDescription>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => {e.stopPropagation()}}>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onSettings?.(team)
              }}
            >
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            {canManage && (
              <>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    onAddMember?.(team)
                  }}
                >
                  <UserPlus className="mr-2 h-4 w-4" />
                  Add Member
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete?.(team)
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Team
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent>
        <div className="text-muted-foreground flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <Users className="h-4 w-4" />
            <span>{team._count?.members ?? 0} members</span>
          </div>
          <div className="flex items-center gap-1.5">
            <FolderKanban className="h-4 w-4" />
            <span>{team._count?.projects ?? 0} projects</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// Export Team type for external use
export type { Team }
