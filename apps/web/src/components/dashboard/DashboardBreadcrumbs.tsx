'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Fragment, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { useProjectList } from '@/domains/project/hooks'
import { useServiceList } from '@/domains/service/hooks'
import { buildBreadcrumbs } from './breadcrumbs-model'
import { Home } from 'lucide-react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@repo/ui/components/shadcn/breadcrumb'

/**
 * DashboardBreadcrumbs — breadcrumb trail for the dashboard header.
 * 
 * Calls usePathname() (URL data). On routes with dynamic params not covered
 * by generateStaticParams, the pathname suspends during prerendering. The
 * Suspense boundary lives in the dashboard layout (server tree) — it wraps
 * this component so the static shell can commit and the breadcrumbs stream
 * in behind their skeleton.
 */
export function DashboardBreadcrumbs() {
  return <DashboardBreadcrumbsInner />
}

function DashboardBreadcrumbsInner() {
  const pathname = usePathname()
  const { data: projectsData } = useProjectList({ query: { limit: 50, offset: 0 } })
  const { data: servicesData } = useServiceList({ query: { limit: 50, offset: 0 } })

  const names = useMemo(() => {
    const map = new Map<string, string>()
    const projects = (projectsData as { data?: { id: string; name?: string | null }[] } | undefined)?.data ?? []
    for (const p of projects) if (p.name) map.set(`projects:${p.id}`, p.name)
    const services = (servicesData as { data?: { id: string; name?: string | null }[] } | undefined)?.data ?? []
    for (const sv of services) if (sv.name) map.set(`services:${sv.id}`, sv.name)
    return map
  }, [projectsData, servicesData])

  const breadcrumbs = buildBreadcrumbs(pathname, (kind, id) => names.get(`${kind}:${id}`))

  if (breadcrumbs.length === 0) return null

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {breadcrumbs.map((crumb, index) => {
          const isLast = index === breadcrumbs.length - 1
          const isFirst = index === 0
          // On phones keep only the first and last crumbs; the middle ones return from `sm`.
          const hideOnPhone = !isFirst && !isLast
          const content = (
            <>
              {isFirst ? <Home className="size-3.5 shrink-0" aria-hidden /> : null}
              <span className={cn('truncate', crumb.mono && 'font-mono text-xs')}>{crumb.label}</span>
            </>
          )
          return (
            <Fragment key={crumb.href}>
              <BreadcrumbItem className={cn('min-w-0', hideOnPhone && 'hidden sm:inline-flex')}>
                {isLast ? (
                  <BreadcrumbPage className="flex min-w-0 items-center gap-1" title={crumb.label}>
                    {content}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href} className="flex min-w-0 items-center gap-1">
                      {content}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast ? <BreadcrumbSeparator className={cn(hideOnPhone && 'hidden sm:block')} /> : null}
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
