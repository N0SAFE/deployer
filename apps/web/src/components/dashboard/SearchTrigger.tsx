'use client'

import { Search } from 'lucide-react'
import { openCommandPalette } from './command-palette-store'

/**
 * SearchTrigger — the header's ⌘K entry point. Styled like a search field so
 * it reads as "type to search", but opens the command palette instead.
 */
export function SearchTrigger() {
  return (
    <button
      type="button"
      onClick={() => openCommandPalette()}
      className="group inline-flex h-8 w-full max-w-64 items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-2.5 text-sm text-muted-foreground transition-colors hover:border-border hover:bg-background/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      aria-label="Open command palette"
    >
      <Search className="size-3.5 shrink-0" />
      <span className="flex-1 truncate text-left text-xs">Search…</span>
      <kbd className="hidden items-center gap-0.5 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
        ⌘K
      </kbd>
    </button>
  )
}
