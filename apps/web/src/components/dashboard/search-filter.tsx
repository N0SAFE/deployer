'use client'

import type { JSX } from 'react'
import { Input } from '@repo/ui/components/shadcn/input'
import { Button } from '@repo/ui/components/shadcn/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Search, X } from 'lucide-react'

interface FilterOption {
  value: string
  label: string
}

interface SearchFilterProps {
  searchValue: string
  onSearchChange: (value: string) => void
  searchPlaceholder?: string
  filters?: {
    key: string
    label: string
    value: string
    options: FilterOption[]
    onChange: (value: string) => void
  }[]
  activeFilters?: {
    key: string
    label: string
    value: string
    onRemove: () => void
  }[]
  onClearAll?: () => void
}

export function SearchFilter({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search...',
  filters = [],
  activeFilters = [],
  onClearAll,
}: SearchFilterProps): JSX.Element {
  const hasActiveFilters = activeFilters.length > 0 || searchValue.length > 0

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <Input
            value={searchValue}
            onChange={(e) => { onSearchChange(e.target.value) }}
            placeholder={searchPlaceholder}
            className="pl-9"
          />
          {searchValue && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2"
              onClick={() => { onSearchChange('') }}
            >
              <X className="h-3 w-3" />
              <span className="sr-only">Clear search</span>
            </Button>
          )}
        </div>

        {filters.map((filter) => (
          <Select
            key={filter.key}
            value={filter.value}
            onValueChange={filter.onChange}
          >
            <SelectTrigger className="w-full sm:w-[150px]">
              <SelectValue placeholder={filter.label} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All {filter.label}</SelectItem>
              {filter.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
      </div>

      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-sm">Active filters:</span>
          {searchValue && (
            <Badge variant="secondary" className="gap-1">
              Search: {searchValue}
              <button
                onClick={() => { onSearchChange('') }}
                className="hover:bg-muted ml-1 rounded-full"
              >
                <X className="h-3 w-3" />
                <span className="sr-only">Remove search filter</span>
              </button>
            </Badge>
          )}
          {activeFilters.map((filter) => (
            <Badge key={filter.key} variant="secondary" className="gap-1">
              {filter.label}: {filter.value}
              <button
                onClick={filter.onRemove}
                className="hover:bg-muted ml-1 rounded-full"
              >
                <X className="h-3 w-3" />
                <span className="sr-only">Remove {filter.label} filter</span>
              </button>
            </Badge>
          ))}
          {onClearAll && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={onClearAll}
            >
              Clear all
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
