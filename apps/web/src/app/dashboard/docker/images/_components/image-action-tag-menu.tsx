'use client'

import { useState } from 'react'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@repo/ui/components/shadcn/command'
import { Popover, PopoverContent, PopoverTrigger } from '@repo/ui/components/shadcn/popover'
import { Download, Loader2, Play } from 'lucide-react'
import type { TagSelectionOption } from '../models'

interface ImageActionTagMenuProps {
  title: string
  icon: 'run' | 'pull'
  options: TagSelectionOption[]
  loading?: boolean
  emptyMessage: string
  onSelect: (value: string) => void
}

export function ImageActionTagMenu({ title, icon, options, loading = false, emptyMessage, onSelect }: ImageActionTagMenuProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={title}
          aria-label={title}
          className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          disabled={loading}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon === 'run' ? <Play className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <Command className="w-full">
          <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">{title}</div>
          <CommandInput className="h-9" placeholder="Search tag..." />
          <CommandList className="max-h-72 overflow-auto">
            <CommandEmpty className="py-3 text-xs text-muted-foreground">{emptyMessage}</CommandEmpty>
            <CommandGroup className="p-1">
              {options.map((option) => (
                <CommandItem
                  className="px-2 py-1.5"
                  key={option.value}
                  value={`${option.label} ${option.description}`}
                  onSelect={() => {
                    onSelect(option.value)
                    setOpen(false)
                  }}
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs">{option.label}</p>
                    <p className="truncate text-xs text-muted-foreground">{option.description}</p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
