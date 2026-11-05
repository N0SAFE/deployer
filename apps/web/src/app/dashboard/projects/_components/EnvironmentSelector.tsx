'use client'

import { Loader2 } from 'lucide-react'

import { Label } from '@deployer/ui/components/shadcn/label'

import { EnvironmentBadge } from '@/components/dashboard'
import { useProjectEnvironments } from '@/domains/project/hooks'
import { cn } from '@/lib/utils'

interface EnvironmentSelectorProps {
    projectId: string
    value: string[]
    onChange: (environments: string[]) => void
    disabled?: boolean
}

export function EnvironmentSelector({
    projectId,
    value,
    onChange,
    disabled,
}: EnvironmentSelectorProps) {
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
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" />
                Loading environments...
            </div>
        )
    }

    return (
        <div className="space-y-3">
            <Label>Deployment environments</Label>
            {environments.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                    No environments defined for this project.
                </p>
            ) : (
                <div className="flex flex-wrap gap-2">
                    {environments.map((env) => {
                        const envId = env.id
                        const envName = env.name
                        const isSelected = value.includes(envId)
                        return (
                            <button
                                key={envId}
                                type="button"
                                onClick={() => {
                                    handleToggleEnv(envId)
                                }}
                                disabled={disabled}
                                aria-pressed={isSelected}
                                className={cn(
                                    'focus-visible:ring-ring rounded-full border transition-all focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
                                    isSelected
                                        ? 'border-primary/50 bg-primary/10'
                                        : 'border-border/60 bg-background/40 hover:border-border/90'
                                )}
                            >
                                <EnvironmentBadge environment={envName} />
                            </button>
                        )
                    })}
                </div>
            )}
            <p className="text-muted-foreground text-xs">
                Select which environments this service will be deployed to.
            </p>
        </div>
    )
}
