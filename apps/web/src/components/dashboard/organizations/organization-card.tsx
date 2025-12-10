'use client'

import type { JSX } from 'react'
import type { Organization } from 'better-auth/plugins'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@repo/ui/components/shadcn/avatar'
import { Button } from '@repo/ui/components/shadcn/button'
import {
  Building2,
  Users,
  FolderKanban,
  MoreHorizontal,
  Settings,
  Trash2,
  Crown,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@repo/ui/components/shadcn/dropdown-menu'
import { cn } from '@/lib/utils'

interface OrganizationCardProps {
  organization: Organization & {
    _count?: {
      members?: number
      teams?: number
      projects?: number
    }
  }
  isActive?: boolean
  role?: 'owner' | 'admin' | 'member'
  onSelect?: (org: Organization) => void
  onSettings?: (org: Organization) => void
  onDelete?: (org: Organization) => void
  className?: string
}

export function OrganizationCard({
  organization,
  isActive = false,
  role,
  onSelect,
  onSettings,
  onDelete,
  className,
}: OrganizationCardProps): JSX.Element {
  const initials = organization.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <Card
      className={cn(
        'relative transition-all hover:shadow-md',
        isActive && 'ring-primary ring-2',
        onSelect && 'cursor-pointer',
        className
      )}
      onClick={() => onSelect?.(organization)}
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
          <Avatar className="h-12 w-12">
            <AvatarImage src={organization.logo ?? undefined} alt={organization.name} />
            <AvatarFallback className="bg-primary/10 text-primary text-lg font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              {organization.name}
              {role === 'owner' && (
                <Crown className="h-4 w-4 text-amber-500" />
              )}
            </CardTitle>
            <CardDescription className="text-muted-foreground text-sm">
              {organization.slug}
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
                onSettings?.(organization)
              }}
            >
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            {(role === 'owner' || role === 'admin') && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete?.(organization)
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
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
            <span>{organization._count?.members ?? 0} members</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Building2 className="h-4 w-4" />
            <span>{organization._count?.teams ?? 0} teams</span>
          </div>
          <div className="flex items-center gap-1.5">
            <FolderKanban className="h-4 w-4" />
            <span>{organization._count?.projects ?? 0} projects</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
