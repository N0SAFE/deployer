'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Fragment } from 'react'
import { Home } from 'lucide-react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@repo/ui/components/shadcn/breadcrumb'

interface BreadcrumbConfig {
  label: string
  href?: string
}

/**
 * Mapping of path segments to human-readable labels
 * Add entries here to customize breadcrumb labels
 */
const pathLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  deployments: 'Deployments',
  admin: 'Admin',
  users: 'Users',
  system: 'System',
  profile: 'Profile',
  demo: 'Demo',
  settings: 'Settings',
  projects: 'Projects',
  docker: 'Docker',
  containers: 'Containers',
  logs: 'Logs',
  shell: 'Shell',
  images: 'Images',
  volumes: 'Volumes',
  networks: 'Networks',
  stacks: 'Stacks',
  registry: 'Registry',
  activity: 'Activity',
  events: 'Activity',
  terminal: 'Shell',
}

function formatSegmentLabel(segment: string): string {
  // Check for custom mapping
  const customLabel = pathLabels[segment.toLowerCase()]
  if (customLabel) {
    return customLabel
  }
  
  // Check if it looks like a UUID or ID — detail layouts (project/service)
  // render their own richer breadcrumbs, so a generic "Details" is noise.
  const uuidRegex = /^[a-f0-9-]{36}$/i
  const mongoIdRegex = /^[a-f0-9]{24}$/i
  if (uuidRegex.exec(segment) ?? mongoIdRegex.exec(segment)) {
    return ''
  }
  
  // Convert kebab-case or camelCase to Title Case
  return segment
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

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
  
  // Split pathname into segments and filter out empty ones
  const segments = pathname.split('/').filter(Boolean)
  
  // Skip if we're at the root dashboard
  if (segments.length === 0) {
    return null
  }
  
  // Build breadcrumb items — dynamic-ID segments (project/service detail)
  // render their own richer breadcrumbs, so skip them here to avoid "Details".
  const breadcrumbs: BreadcrumbConfig[] = []
  segments.forEach((segment, index) => {
    const href = '/' + segments.slice(0, index + 1).join('/')
    const label = formatSegmentLabel(segment)
    if (label) {
      breadcrumbs.push({ label, href })
    }
  })
  
  // Don't show breadcrumbs if only at dashboard root
  if (breadcrumbs.length === 1 && breadcrumbs[0]?.href === '/dashboard') {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage className="flex items-center gap-1">
              <Home className="h-3.5 w-3.5" />
              Dashboard
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    )
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {breadcrumbs.map((crumb, index) => {
          const isLast = index === breadcrumbs.length - 1
          const isFirst = index === 0
          
          return (
            <Fragment key={crumb.href}>
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage className="flex items-center gap-1">
                    {isFirst && <Home className="h-3.5 w-3.5" />}
                    {crumb.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href ?? ''} className="flex items-center gap-1">
                      {isFirst && <Home className="h-3.5 w-3.5" />}
                      {crumb.label}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
