'use client'

import { Boxes, GitBranch, Network, Search } from 'lucide-react'
import { ENV_NAMES } from '@deployer/contracts-common'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deployer/ui/components/shadcn/select'
import { cn } from '@/lib/utils'

export type DependencyMode = 'expected' | 'real'
export type StatusFilter = 'all' | 'active' | 'inactive'

const ENV_OPTIONS = ['all', ...ENV_NAMES] as const

function isStatusFilter(value: string): value is StatusFilter {
  return value === 'all' || value === 'active' || value === 'inactive'
}

/** Expected (declared) vs Real state (runtime) switch. */
export function ModeToggle({ mode, onChange }: { mode: DependencyMode; onChange: (mode: DependencyMode) => void }) {
  const options: { value: DependencyMode; label: string; icon: typeof GitBranch }[] = [
    { value: 'expected', label: 'Expected', icon: GitBranch },
    { value: 'real', label: 'Real state', icon: Boxes },
  ]
  return (
    <div role="group" aria-label="Dependency view" className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 p-1">
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => { onChange(value) }}
          aria-pressed={mode === value}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring',
            mode === value ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="size-3.5" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  )
}

/** Search, environment and status filters plus the visible-count chips. */
export function DependencyFilters({
  search,
  onSearch,
  environment,
  onEnvironment,
  status,
  onStatus,
  visibleCount,
  totalCount,
  containerSummary,
}: {
  search: string
  onSearch: (value: string) => void
  environment: string
  onEnvironment: (value: string) => void
  status: StatusFilter
  onStatus: (value: StatusFilter) => void
  visibleCount: number
  totalCount: number
  /** Present only in Real state mode. `null` while containers load. */
  containerSummary?: { containers: number; running: number } | null
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-40 max-w-xs flex-1">
        <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={search}
          onChange={(e) => { onSearch(e.target.value) }}
          placeholder="Filter services…"
          aria-label="Filter services by name"
          className="h-8 pl-8 text-sm"
        />
      </div>
      <Select value={environment} onValueChange={onEnvironment}>
        <SelectTrigger className="h-8 w-36 text-sm" aria-label="Environment"><SelectValue placeholder="Environment" /></SelectTrigger>
        <SelectContent>
          {ENV_OPTIONS.map((env) => (<SelectItem key={env} value={env} className="capitalize">{env}</SelectItem>))}
        </SelectContent>
      </Select>
      <Select value={status} onValueChange={(v) => { if (isStatusFilter(v)) onStatus(v) }}>
        <SelectTrigger className="h-8 w-32 text-sm" aria-label="Service status"><SelectValue placeholder="Status" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="inactive">Inactive</SelectItem>
        </SelectContent>
      </Select>
      <Badge variant="outline" className="gap-1 text-xs">
        <Network className="size-3" aria-hidden />
        {visibleCount}/{totalCount} services
      </Badge>
      {containerSummary !== undefined ? (
        <Badge variant="outline" className="gap-1 text-xs">
          <Boxes className="size-3" aria-hidden />
          {containerSummary === null ? 'Loading containers…' : `${String(containerSummary.running)}/${String(containerSummary.containers)} containers running`}
        </Badge>
      ) : null}
    </div>
  )
}
