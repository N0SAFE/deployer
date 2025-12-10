'use client'

import type { JSX } from 'react'
import type { Organization } from 'better-auth/plugins'
import { OrganizationCard } from './organization-card'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { cn } from '@/lib/utils'

interface OrganizationListProps {
  organizations: (Organization & {
    _count?: {
      members?: number
      teams?: number
      projects?: number
    }
  })[]
  activeOrganizationId?: string
  isLoading?: boolean
  onSelectOrganization?: (org: Organization) => void
  onSettingsClick?: (org: Organization) => void
  onDeleteClick?: (org: Organization) => void
  getRoleForOrg?: (org: Organization) => 'owner' | 'admin' | 'member' | undefined
  className?: string
}

export function OrganizationList({
  organizations,
  activeOrganizationId,
  isLoading = false,
  onSelectOrganization,
  onSettingsClick,
  onDeleteClick,
  getRoleForOrg,
  className,
}: OrganizationListProps): JSX.Element {
  if (isLoading) {
    return (
      <div className={cn('grid gap-4 md:grid-cols-2 lg:grid-cols-3', className)}>
        {Array.from({ length: 3 }).map((_, i) => (
          <OrganizationCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (organizations.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center justify-center py-12 text-center">
        <p className="text-lg font-medium">No organizations found</p>
        <p className="text-sm">Create your first organization to get started</p>
      </div>
    )
  }

  return (
    <div className={cn('grid gap-4 md:grid-cols-2 lg:grid-cols-3', className)}>
      {organizations.map((org) => (
        <OrganizationCard
          key={org.id}
          organization={org}
          isActive={org.id === activeOrganizationId}
          role={getRoleForOrg?.(org)}
          onSelect={onSelectOrganization}
          onSettings={onSettingsClick}
          onDelete={onDeleteClick}
        />
      ))}
    </div>
  )
}

function OrganizationCardSkeleton(): JSX.Element {
  return (
    <div className="bg-card rounded-lg border p-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div>
            <Skeleton className="mb-1 h-5 w-32" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <Skeleton className="h-8 w-8" />
      </div>
      <div className="mt-4 flex items-center gap-4">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20" />
      </div>
    </div>
  )
}
