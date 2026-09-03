'use client'

import { useProjectEnvironments } from '@/domains/project/hooks'
import { Label } from '@repo/ui/components/shadcn/label'
import { EnvironmentBadge } from '@/components/dashboard'
import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

interface EnvironmentSelectorProps {
  projectId: string
  value: string[]
  onChange: (environments: string[]) => void
  disabled?: boolean
}

/** Minimal environment row shape read from the project environments API. */
interface EnvironmentRow {
  id: string
  slug?: string | null
  name?: string | null
  type?: string | null
  kind?: string | null
}

export function EnvironmentSelector({ projectId, value, onChange, disabled }: EnvironmentSelectorProps) {
  const { data: envData, isLoading } = useProjectEnvironments(projectId)

  const environments = envData?.environments ?? []

  const handleToggleEnv = (envId: string) => {
    if (value.includes(envId)) {
      onChange(value.filter((e) => e !== envId))
    } else {
      onChange([...value, envId])
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading environments...
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Label>Deployment environments</Label>
      {environments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No environments defined for this project.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {(environments as EnvironmentRow[]).map((env) => {
            const envId = env.id ?? env.slug ?? ''
            const envName = env.name ?? env.slug ?? envId
            const isSelected = value.includes(envId)
            return (
              <button
                key={envId}
                type="button"
                onClick={() => { handleToggleEnv(envId) }}
                disabled={disabled}
                aria-pressed={isSelected}
                className={cn(
                  'rounded-full border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                  isSelected
                    ? 'border-primary/50 bg-primary/10'
                    : 'border-border/60 bg-background/40 hover:border-border/90',
                )}
              >
                <EnvironmentBadge environment={envName} />
              </button>
            )
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Select which environments this service will be deployed to.
      </p>
    </div>
  )
}
