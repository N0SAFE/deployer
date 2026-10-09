'use client'

import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface ScopedNavItem {
  key: string
  title: string
  icon: ComponentType<{ className?: string }>
  active: boolean
  /** Renders the typed route Link (routes need params, so the caller binds them). */
  renderLink: (props: { className: string; children: ReactNode; 'aria-current'?: 'page' }) => ReactNode
}

/**
 * Same look as the shell's `SectionNav` (underline tabs, scrolls horizontally at
 * 375 px) for sections whose routes take params, which `SectionNav` cannot bind.
 */
export function ScopedSectionNav({ label, items }: { label: string; items: readonly ScopedNavItem[] }) {
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto border-b">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <span key={item.key} className="contents">
            {item.renderLink({
              'aria-current': item.active ? 'page' : undefined,
              className: cn(
                '-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
                item.active ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              ),
              children: (<><Icon className="size-4" />{item.title}</>),
            })}
          </span>
        )
      })}
    </nav>
  )
}
