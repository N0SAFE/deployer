'use client'

import type { JSX } from 'react'
import { TeamCard, type Team } from './team-card'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { cn } from '@/lib/utils'

interface TeamListProps {
  teams: (Team & {
    _count?: {
      members?: number
      projects?: number
    }
  })[]
  activeTeamId?: string
  isLoading?: boolean
  getUserRoleForTeam?: (team: Team) => 'lead' | 'member' | undefined
  onSelectTeam?: (team: Team) => void
  onSettingsClick?: (team: Team) => void
  onAddMemberClick?: (team: Team) => void
  onDeleteClick?: (team: Team) => void
  className?: string
}

export function TeamList({
  teams,
  activeTeamId,
  isLoading = false,
  getUserRoleForTeam,
  onSelectTeam,
  onSettingsClick,
  onAddMemberClick,
  onDeleteClick,
  className,
}: TeamListProps): JSX.Element {
  if (isLoading) {
    return (
      <div className={cn('grid gap-4 md:grid-cols-2 lg:grid-cols-3', className)}>
        {Array.from({ length: 3 }).map((_, i) => (
          <TeamCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (teams.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center justify-center py-12 text-center">
        <p className="text-lg font-medium">No teams found</p>
        <p className="text-sm">Create your first team to organize your projects</p>
      </div>
    )
  }

  return (
    <div className={cn('grid gap-4 md:grid-cols-2 lg:grid-cols-3', className)}>
      {teams.map((team) => (
        <TeamCard
          key={team.id}
          team={team}
          isActive={team.id === activeTeamId}
          userRole={getUserRoleForTeam?.(team)}
          onSelect={onSelectTeam}
          onSettings={onSettingsClick}
          onAddMember={onAddMemberClick}
          onDelete={onDeleteClick}
        />
      ))}
    </div>
  )
}

function TeamCardSkeleton(): JSX.Element {
  return (
    <div className="bg-card rounded-lg border p-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div>
            <Skeleton className="mb-1 h-5 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        <Skeleton className="h-8 w-8" />
      </div>
      <div className="mt-4 flex items-center gap-4">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20" />
      </div>
    </div>
  )
}
