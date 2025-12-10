'use client'

import type { JSX } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@repo/ui/components/shadcn/button'
import {
  Cloud,
  FileQuestion,
  Inbox,
  Rocket,
  Server,
  type LucideIcon,
} from 'lucide-react'

export type EmptyStateVariant = 'default' | 'projects' | 'deployments' | 'services' | 'search'

const variantConfig: Record<
  EmptyStateVariant,
  {
    icon: LucideIcon
    title: string
    description: string
  }
> = {
  default: {
    icon: Inbox,
    title: 'No data available',
    description: 'There is nothing to display at the moment.',
  },
  projects: {
    icon: Cloud,
    title: 'No projects yet',
    description: 'Create your first project to get started with deployments.',
  },
  deployments: {
    icon: Rocket,
    title: 'No deployments',
    description: 'Deploy your first service to see deployment history here.',
  },
  services: {
    icon: Server,
    title: 'No services',
    description: 'Add services to this project to enable deployments.',
  },
  search: {
    icon: FileQuestion,
    title: 'No results found',
    description: 'Try adjusting your search or filter criteria.',
  },
}

interface EmptyStateProps {
  variant?: EmptyStateVariant
  title?: string
  description?: string
  icon?: LucideIcon
  action?: {
    label: string
    onClick: () => void
  }
  /** Pass a custom action element (e.g., a Dialog trigger) instead of the default Button */
  actionElement?: React.ReactNode
  className?: string
}

export function EmptyState({
  variant = 'default',
  title,
  description,
  icon,
  action,
  actionElement,
  className,
}: EmptyStateProps): JSX.Element {
  const config = variantConfig[variant]
  const Icon = icon ?? config.icon

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center',
        className
      )}
    >
      <div className="bg-muted mb-4 rounded-full p-3">
        <Icon className="text-muted-foreground h-6 w-6" />
      </div>
      <h3 className="mb-1 text-lg font-semibold">{title ?? config.title}</h3>
      <p className="text-muted-foreground mb-4 max-w-sm text-sm">
        {description ?? config.description}
      </p>
      {actionElement}
      {action && !actionElement && (
        <Button onClick={action.onClick} size="sm">
          {action.label}
        </Button>
      )}
    </div>
  )
}
