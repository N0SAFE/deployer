'use client'

import type { JSX } from 'react'
import { ServiceCard, type Service } from './service-card'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Card, CardContent, CardHeader } from '@repo/ui/components/shadcn/card'
import { cn } from '@/lib/utils'

interface ServiceListProps {
  services: Service[]
  isLoading?: boolean
  onSelectService?: (service: Service) => void
  onSettingsService?: (service: Service) => void
  onDeleteService?: (service: Service) => void
  onViewServiceUrl?: (service: Service) => void
  emptyMessage?: string
  className?: string
}

function ServiceCardSkeleton(): JSX.Element {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <div>
            <Skeleton className="mb-2 h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        <Skeleton className="h-5 w-16" />
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-12" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="h-4 w-20" />
        </div>
      </CardContent>
    </Card>
  )
}

export function ServiceList({
  services,
  isLoading = false,
  onSelectService,
  onSettingsService,
  onDeleteService,
  onViewServiceUrl,
  emptyMessage = 'No services found',
  className,
}: ServiceListProps): JSX.Element {
  if (isLoading) {
    return (
      <div className={cn('grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3', className)}>
        {Array.from({ length: 6 }).map((_, i) => (
          <ServiceCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (services.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-12', className)}>
        <p className="text-muted-foreground text-sm">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className={cn('grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3', className)}>
      {services.map((service) => (
        <ServiceCard
          key={service.id}
          service={service}
          onSelect={onSelectService}
          onSettings={onSettingsService}
          onDelete={onDeleteService}
          onViewUrl={onViewServiceUrl}
        />
      ))}
    </div>
  )
}
