'use client'

import { useState } from 'react'
import { Button } from '@repo/ui/components/shadcn/button'
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

/**
 * Combobox-style field: pick a preset OR type a custom value.
 * Used across the wizard where a value has common presets but must
 * remain free-form (e.g. root paths, start commands, compose files).
 */
export function AutocompleteField({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Search or type a custom value…',
  emptyMessage = 'No preset found.',
  allowCustom = true,
  detected,
  className,
}: {
  value: string
  onChange: (next: string) => void
  options: readonly string[]
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  /** Allow free-text custom values not in the presets. */
  allowCustom?: boolean
  /** A suggested value (e.g. from auto-detection) highlighted in the list. */
  detected?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const allOptions = detected && !options.includes(detected) ? [detected, ...options] : [...options]
  const filtered = allOptions.filter((o) => o.toLowerCase().includes(search.toLowerCase()))
  const customValue = search.trim()

  const select = (next: string) => {
    onChange(next)
    setOpen(false)
    setSearch('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('w-full justify-between font-normal', className)}
        >
          <span className={cn('truncate', !value && 'text-muted-foreground')}>
            {value || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 size-3.5 shrink-0 opacity-50" />
        </Button>
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
                    key={o}
                    value={o}
                    onSelect={() => { select(o) }}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{o}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {detected === o && <span className="text-[10px] text-primary">detected</span>}
                      {value === o && <Check className="size-3.5 text-primary" />}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {allowCustom && customValue && !filtered.includes(customValue) && (
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
