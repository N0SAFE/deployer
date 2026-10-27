'use client'

import { Check } from 'lucide-react'
import { cn } from '@deployer/ui/lib/utils'
import type { RunnerFormData } from '../../CreateService.hook'
import { RUNNER_META } from '../runner-presets'

/** Grid of selectable runner-type cards. */
export function RunnerTypePicker({ value, onChange }: { value: RunnerFormData['runnerId']; onChange: (v: RunnerFormData['runnerId']) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {RUNNER_META.map((opt) => {
        const Icon = opt.icon
        const selected = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => { onChange(opt.value) }}
            className={cn(
              'group relative flex flex-col gap-1 rounded-lg border p-2.5 text-left transition-all',
              selected
                ? 'border-primary bg-primary/10 ring-1 ring-primary'
                : 'border-border bg-background/40 hover:border-primary/40 hover:bg-muted/40',
            )}
          >
            {selected && (
              <span className="absolute right-1.5 top-1.5 flex size-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check className="size-2.5" />
              </span>
            )}
            <Icon className="size-4 text-muted-foreground group-hover:text-foreground" />
            <span className="text-xs font-medium leading-tight">{opt.label}</span>
            <span className="line-clamp-3 text-xs leading-snug text-muted-foreground">{opt.description}</span>
          </button>
        )
      })}
    </div>
  )
}
