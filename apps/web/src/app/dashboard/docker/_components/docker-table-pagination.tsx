'use client'

import { Button } from '@repo/ui/components/shadcn/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface DockerTablePaginationProps {
  page: number
  pageSize: number
  totalRows: number
  totalPages: number
  from: number
  to: number
  onPageChange: (nextPage: number) => void
  onPageSizeChange: (nextSize: number) => void
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const

export function DockerTablePagination({
  page,
  pageSize,
  totalRows,
  totalPages,
  from,
  to,
  onPageChange,
  onPageSizeChange,
}: DockerTablePaginationProps) {
  const canGoPrevious = page > 1
  const canGoNext = page < totalPages

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">
      <div className="text-muted-foreground">
        Showing <span className="font-medium text-foreground">{from}</span>–<span className="font-medium text-foreground">{to}</span> of <span className="font-medium text-foreground">{totalRows}</span>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="docker-table-page-size" className="text-muted-foreground">Rows</label>
        <select
          id="docker-table-page-size"
          className="h-8 rounded-md border border-border/70 bg-background/70 px-2 text-xs"
          value={pageSize}
          onChange={(event) => {
            onPageSizeChange(Number(event.target.value))
          }}
        >
          {PAGE_SIZE_OPTIONS.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>

        <div className="px-1.5 text-muted-foreground">
          Page <span className="font-medium text-foreground">{page}</span> / <span className="font-medium text-foreground">{totalPages}</span>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1"
          disabled={!canGoPrevious}
          onClick={() => {
            onPageChange(page - 1)
          }}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Prev
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1"
          disabled={!canGoNext}
          onClick={() => {
            onPageChange(page + 1)
          }}
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
