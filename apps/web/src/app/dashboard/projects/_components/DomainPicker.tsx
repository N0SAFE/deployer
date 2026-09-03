'use client'

import { useProjectDomains } from '@/domains/domain/hooks'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import { Label } from '@repo/ui/components/shadcn/label'
import { Loader2 } from 'lucide-react'

interface DomainPickerProps {
  projectId: string
  value: string[]
  onChange: (domains: string[]) => void
  disabled?: boolean
}

export function DomainPicker({ projectId, value, onChange, disabled }: DomainPickerProps) {
  const { data: domainData, isLoading } = useProjectDomains(projectId)

  const domains = domainData ?? []

  const handleToggleDomain = (domainKey: string) => {
    if (value.includes(domainKey)) {
      onChange(value.filter((d) => d !== domainKey))
    } else {
      onChange([...value, domainKey])
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading domains...
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Label>Registered domains</Label>
      {domains.length === 0 ? (
        <p className="text-sm text-muted-foreground">No domains registered for this project.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {domains.map((domain: any) => {
            const domainStr = domain.domain ?? domain.name ?? ''
            const isSelected = value.includes(domainStr)
            return (
              <button
                key={domainStr}
                type="button"
                onClick={() => handleToggleDomain(domainStr)}
                disabled={disabled}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  isSelected
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-muted-foreground'
                }`}
              >
                {domainStr}
                {domain.isVerified === false && ' (unverified)'}
              </button>
            )
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">Click a domain to add it. Manage domains in project settings.</p>
    </div>
  )
}
