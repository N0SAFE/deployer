'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@deployer/ui/components/shadcn/button'

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
        <nav
            aria-label="Pagination"
            className="border-border/60 bg-background/50 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"
        >
            <div className="text-muted-foreground">
                Showing{' '}
                <span className="text-foreground font-medium">{from}</span>–
                <span className="text-foreground font-medium">{to}</span> of{' '}
                <span className="text-foreground font-medium">{totalRows}</span>
            </div>

            <div className="flex items-center gap-2">
                <label
                    htmlFor="docker-table-page-size"
                    className="text-muted-foreground"
                >
                    Rows
                </label>
                <select
                    id="docker-table-page-size"
                    className="border-border/70 bg-background/70 h-8 rounded-md border px-2 text-xs"
                    value={pageSize}
                    onChange={(event) => {
                        onPageSizeChange(Number(event.target.value))
                    }}
                >
                    {PAGE_SIZE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                            {option}
                        </option>
                    ))}
                </select>

                <div className="text-muted-foreground px-1.5">
                    Page{' '}
                    <span className="text-foreground font-medium">{page}</span>{' '}
                    /{' '}
                    <span className="text-foreground font-medium">
                        {totalPages}
                    </span>
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
        </nav>
    )
}
