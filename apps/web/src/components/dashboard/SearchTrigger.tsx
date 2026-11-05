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
            onClick={() => {
                openCommandPalette()
            }}
            className="group border-border/60 bg-background/60 text-muted-foreground hover:border-border hover:bg-background/90 focus-visible:ring-ring inline-flex h-8 w-full max-w-64 items-center gap-2 rounded-lg border px-2.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none"
            aria-label="Open command palette"
        >
            <Search className="size-3.5 shrink-0" />
            <span className="flex-1 truncate text-left text-xs">Search…</span>
            <kbd className="border-border/60 bg-muted/40 text-muted-foreground hidden items-center gap-0.5 rounded-md border px-1.5 py-0.5 font-mono text-xs sm:inline-flex">
                ⌘K
            </kbd>
        </button>
    )
}
