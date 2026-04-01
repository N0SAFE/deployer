"use client"

import * as React from "react"
import { Check, ChevronDown, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "./badge"
import { Button } from "./button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./command"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"

export interface MultiSelectOption {
  value: string
  label: string
  description?: string
}

interface MultiSelectProps {
  options: MultiSelectOption[]
  value: string[]
  onValueChange: (next: string[]) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  className?: string
  disabled?: boolean
}

export function MultiSelect({
  options,
  value,
  onValueChange,
  placeholder = "Select options",
  searchPlaceholder = "Search...",
  emptyMessage = "No option found.",
  className,
  disabled,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false)

  const selectedOptions = React.useMemo(() => {
    const selected = new Set(value)
    return options.filter((option) => selected.has(option.value))
  }, [options, value])

  function toggleValue(nextValue: string): void {
    const selected = new Set(value)
    if (selected.has(nextValue)) selected.delete(nextValue)
    else selected.add(nextValue)
    onValueChange(Array.from(selected))
  }

  return (
    <div className={cn("space-y-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
            disabled={disabled}
          >
            <span className="truncate text-left">
              {selectedOptions.length > 0 ? `${String(selectedOptions.length)} selected` : placeholder}
            </span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-70" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>{emptyMessage}</CommandEmpty>
              <CommandGroup>
                {options.map((option) => {
                  const checked = value.includes(option.value)
                  return (
                    <CommandItem
                      key={option.value}
                      value={`${option.label} ${option.value}`}
                      onSelect={() => {toggleValue(option.value)}}
                    >
                      <div
                        className={cn(
                          "mr-2 flex h-4 w-4 items-center justify-center rounded border",
                          checked ? "border-primary bg-primary text-primary-foreground" : "opacity-60",
                        )}
                      >
                        <Check className="h-3 w-3" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate">{option.label}</p>
                        {option.description ? (
                          <p className="truncate text-xs text-muted-foreground">{option.description}</p>
                        ) : null}
                      </div>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedOptions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedOptions.map((option) => (
            <Badge key={option.value} variant="secondary" className="gap-1 pr-1">
              <span>{option.label}</span>
              <button
                type="button"
                className="rounded-sm p-0.5 hover:bg-background/60"
                onClick={() => {toggleValue(option.value)}}
                aria-label={`Remove ${option.label}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}
