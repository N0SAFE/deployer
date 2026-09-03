'use client'

import { useState } from 'react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@repo/ui/components/shadcn/command'
import { Popover, PopoverContent, PopoverTrigger } from '@repo/ui/components/shadcn/popover'
import { Check, ChevronsUpDown, PencilLine } from 'lucide-react'
import { cn } from '@repo/ui/lib/utils'

export interface SearchableOption {
  value: string
  /** Shown label (defaults to value). */
  label?: string
  /** Secondary line (e.g. repo language · private). */
  description?: string
  /** Small badge text on the right (e.g. "detected", "prod"). */
  badge?: string
}

/**
 * Fluent searchable select: type to filter, pick a preset, or (optionally)
 * use the typed value as a custom value. Used everywhere a plain <Select>
 * would bury the user under a long unsearchable list (repos, branches,
 * apps, compose candidates, …).
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyMessage = 'No match found.',
  allowCustom = false,
  className,
}: {
  value: string
  onChange: (next: string) => void
  options: SearchableOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  /** Allow the typed text to be committed as a custom value. */
  allowCustom?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const q = search.trim().toLowerCase()
  const filtered = q ? options.filter((o) => (o.label ?? o.value).toLowerCase().includes(q) || o.value.toLowerCase().includes(q)) : options
  const selected = options.find((o) => o.value === value)
  const customValue = search.trim()

  const select = (next: string) => {
    onChange(next)
    setOpen(false)
    setSearch('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'flex w-full items-center justify-between gap-1.5 rounded-md border border-input bg-input/20 px-2 py-1.5 text-xs text-left whitespace-nowrap transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 data-placeholder:text-muted-foreground',
            className,
          )}
        >
          <span className={cn('flex min-w-0 items-center gap-1.5', !value && 'text-muted-foreground')}>
            {selected ? (
              <>
                <span className="truncate">{selected.label ?? selected.value}</span>
                {selected.badge ? (
                  <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground">{selected.badge}</span>
                ) : null}
              </>
            ) : (
              <span className="truncate">{value || placeholder}</span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 size-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            {filtered.length > 0 && (
              <CommandGroup>
                {filtered.map((o) => (
                  <CommandItem
                    key={o.value}
                    value={o.value}
                    onSelect={() => { select(o.value) }}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{o.label ?? o.value}</span>
                      {o.description ? <span className="truncate text-[11px] text-muted-foreground">{o.description}</span> : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {o.badge ? <span className="rounded bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground">{o.badge}</span> : null}
                      {value === o.value && <Check className="size-3.5 text-primary" />}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {allowCustom && customValue && !options.some((o) => o.value === customValue) && (
              <CommandGroup heading="Custom value">
                <CommandItem
                  value={`__custom__${customValue}`}
                  onSelect={() => { select(customValue) }}
                  className="flex items-center gap-2 text-primary"
                >
                  <PencilLine className="size-3.5" />
                  <span className="truncate">Use “{customValue}”</span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
