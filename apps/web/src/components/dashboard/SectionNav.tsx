'use client'

import type { ComponentType, ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { cn } from '@repo/ui/lib/utils'

/** A typed route builder as `@/routes` generates them: callable for the URL, with a `Link`. */
interface SectionRoute {
  (): string
  Link: ComponentType<{ className?: string; children?: ReactNode; 'aria-current'?: 'page' }>
}

export interface SectionNavItem {
  title: string
  route: SectionRoute
  icon: ComponentType<{ className?: string }>
  /** Active only on this exact URL (use for an overview that is a prefix of its siblings). */
  exact?: boolean
  /** Hidden entirely when false — e.g. admin-only entries. */
  visible?: boolean
  /** Small trailing marker, e.g. a count of items waiting for a decision. */
  badge?: ReactNode
}

/**
 * The tab strip a dashboard SECTION shows on all of its pages (Network, Settings,
 * Nodes…). One component so every section navigates the same way, instead of each
 * growing its own variant.
 */
export function SectionNav({ label, items }: { label: string; items: readonly SectionNavItem[] }) {
  const pathname = usePathname()
  return (
    <nav aria-label={label} className="-mb-2 flex gap-1 overflow-x-auto border-b">
      {items
        .filter((item) => item.visible !== false)
        .map((item) => {
          const url = item.route()
          const active = item.exact === true ? pathname === url : pathname.startsWith(url)
          const Icon = item.icon
          const ItemLink = item.route.Link
          return (
            <ItemLink
              key={url}
              aria-current={active ? 'page' : undefined}
              className={cn(
                '-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
                active ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-4" />
              {item.title}
              {item.badge}
            </ItemLink>
          )
        })}
    </nav>
  )
}
