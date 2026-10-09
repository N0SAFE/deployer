'use client'

import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Label } from '@repo/ui/components/shadcn/label'
import { cn } from '@/lib/utils'
import { useProjectDomains } from '@/domains/domain/hooks'
import { InlineError } from './workload/WorkloadStates'

interface DomainPickerProps {
  projectId: string
  value: string[]
  onChange: (domains: string[]) => void
  disabled?: boolean
}

/** Toggle chips for the project's registered domains. Selection is shown by an explicit check, not colour alone. */
export function DomainPicker({ projectId, value, onChange, disabled }: DomainPickerProps) {
  const query = useProjectDomains(projectId)
  const domains = query.data ?? []

  const toggle = (name: string) => {
    onChange(value.includes(name) ? value.filter((d) => d !== name) : [...value, name])
  }

  if (query.isLoading) {
    return <Skeleton role="status" aria-label="Loading domains" className="h-8 w-64" />
  }
  if (query.error) {
    return <InlineError title="Could not load domains" error={query.error} onRetry={() => { void query.refetch() }} />
  }

  return (
    <div className="space-y-2">
      <Label>Registered domains</Label>
      {domains.length === 0 ? (
        <p className="text-sm text-muted-foreground">No domains registered for this project yet. Add one on the project Domains page.</p>
      ) : (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Registered domains">
          {domains.map((domain) => {
            const selected = value.includes(domain.domain)
            return (
              <button
                key={domain.id}
                type="button"
                onClick={() => { toggle(domain.domain) }}
                disabled={disabled}
                aria-pressed={selected}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50',
                  selected ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-muted-foreground',
                )}
              >
                {selected ? '✓ ' : ''}{domain.domain}
                {domain.verificationStatus === 'verified' ? '' : ` (${domain.verificationStatus})`}
              </button>
            )
          })}
        </div>
      )}
      <p className="text-sm text-muted-foreground">Click a domain to select it. Manage domains on the project Domains page.</p>
    </div>
  )
}
