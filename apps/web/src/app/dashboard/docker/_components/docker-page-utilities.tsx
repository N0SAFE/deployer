'use client'

import { useMemo } from 'react'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { TableCell, TableRow } from '@repo/ui/components/shadcn/table'
import { Check, ChevronDown, ChevronRight, Minus } from 'lucide-react'
import type { ReactNode } from 'react'

export interface FilterChip {
  key: string
  label: string
  value: string
}

interface DockerActiveFilterChipsProps {
  chips: FilterChip[]
}

export function DockerActiveFilterChips({ chips }: DockerActiveFilterChipsProps) {
  if (chips.length === 0) {
    return <p className="text-xs text-muted-foreground">No active filters.</p>
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <Badge key={chip.key} variant="outline" className="text-[10px]">
          {chip.label}: {chip.value}
        </Badge>
      ))}
    </div>
  )
}

interface DockerColumnSettingsProps {
  title: string
  columns: Record<string, boolean>
  onToggle: (column: string, visible: boolean) => void
}

interface DockerSelectionToggleProps {
  ariaLabel: string
  pressed: boolean
  indeterminate?: boolean
  shape?: 'square' | 'round'
  onPressedChange: (pressed: boolean) => void
}

export function DockerSelectionToggle({ ariaLabel, pressed, indeterminate = false, shape = 'square', onPressedChange }: DockerSelectionToggleProps) {
  const isActive = pressed || indeterminate

  return (
    <button
      type="button"
      role="checkbox"
      aria-label={ariaLabel}
      aria-checked={indeterminate ? 'mixed' : pressed}
      onClick={() => {
        if (indeterminate || pressed) {
          onPressedChange(false)
          return
        }
        onPressedChange(true)
      }}
      className={`flex size-4 shrink-0 items-center justify-center border border-border/70 text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${shape === 'round' ? 'rounded-full' : 'rounded-lg'} ${isActive ? 'border-primary bg-primary text-primary-foreground' : 'bg-input/40 text-transparent hover:bg-muted/60'}`}
    >
      {indeterminate ? (
        <Minus className="size-3" />
      ) : (
        <Check className={`size-3 ${pressed ? 'opacity-100' : 'opacity-0'}`} />
      )}
    </button>
  )
}

export function DockerColumnSettings({ title, columns, onToggle }: DockerColumnSettingsProps) {
  const entries = useMemo(() => Object.entries(columns), [columns])

  return (
    <details className="rounded-md border px-3 py-2 text-sm">
      <summary className="cursor-pointer select-none font-medium">{title}</summary>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {entries.map(([column, visible]) => (
          <div key={column} className="flex items-center gap-2 rounded-md border border-border/60 bg-background/70 px-2 py-1.5 text-xs">
            <DockerSelectionToggle
              ariaLabel={`Toggle ${column} column`}
              pressed={visible}
              onPressedChange={(pressed) => {
                onToggle(column, pressed)
              }}
            />
            <span className="font-medium">{column}</span>
          </div>
        ))}
      </div>
    </details>
  )
}

interface DockerExportActionsProps<Row extends Record<string, unknown>> {
  filenameBase: string
  rows: Row[]
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0] ?? {})
  const lines = [headers.join(',')]

  for (const row of rows) {
    const line = headers
      .map((header) => {
        const raw = row[header]
        const value =
          raw === null || raw === undefined
            ? ''
            : typeof raw === 'string'
              ? raw
              : typeof raw === 'number'
                ? raw.toString()
                : typeof raw === 'bigint'
                  ? raw.toString()
                  : typeof raw === 'boolean'
                    ? (raw ? 'true' : 'false')
                : typeof raw === 'symbol'
                  ? (raw.description ?? 'symbol')
                  : typeof raw === 'function'
                    ? (raw.name || 'function')
              : typeof raw === 'object'
                ? JSON.stringify(raw)
                : ''
        const escaped = value.replaceAll('"', '""')
        return `"${escaped}"`
      })
      .join(',')
    lines.push(line)
  }

  return lines.join('\n')
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function DockerExportActions<Row extends Record<string, unknown>>({ filenameBase, rows }: DockerExportActionsProps<Row>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          const csv = toCsv(rows)
          downloadTextFile(`${filenameBase}.csv`, csv, 'text/csv;charset=utf-8')
        }}
      >
        Export CSV
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          const json = JSON.stringify(rows, null, 2)
          downloadTextFile(`${filenameBase}.json`, json, 'application/json;charset=utf-8')
        }}
      >
        Export JSON
      </Button>
      <Badge variant="outline">{rows.length} rows</Badge>
    </div>
  )
}

interface DockerExpandableRowToggleProps {
  expanded: boolean
  ariaLabel: string
  onToggle: () => void
  compact?: boolean
}

export function DockerExpandableRowToggle({ expanded, ariaLabel, onToggle, compact = false }: DockerExpandableRowToggleProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={`inline-flex items-center justify-center rounded border border-border/60 hover:bg-muted ${compact ? 'h-6 w-6 rounded-sm border-none text-muted-foreground transition-colors hover:text-foreground' : 'h-6 w-6'}`}
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
    >
      {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
    </button>
  )
}

interface DockerExpandedTableRowProps {
  expanded: boolean
  colSpan: number
  children: ReactNode
  className?: string
  cellClassName?: string
}

export function DockerExpandedTableRow({ expanded, colSpan, children, className, cellClassName }: DockerExpandedTableRowProps) {
  if (!expanded) return null

  return (
    <TableRow className={className ?? 'bg-muted/15'}>
      <TableCell colSpan={colSpan} className={cellClassName}>
        {children}
      </TableCell>
    </TableRow>
  )
}
