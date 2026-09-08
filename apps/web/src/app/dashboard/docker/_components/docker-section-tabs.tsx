'use client'

import Link from 'next/link'
import { Suspense } from 'react'
import { usePathname } from 'next/navigation'
import {
  AuthDashboardDocker,
  AuthDashboardDockerActivity,
  AuthDashboardDockerContainers,
  AuthDashboardDockerImages,
  AuthDashboardDockerLogs,
  AuthDashboardDockerNetworks,
  AuthDashboardDockerShell,
  AuthDashboardDockerVolumes,
} from '@/routes'
import { cn } from '@/lib/utils'

const TABS: Array<{ label: string; href: string }> = [
  { label: 'Overview', href: AuthDashboardDocker() },
  { label: 'Tasks · Containers', href: AuthDashboardDockerContainers() },
  { label: 'Logs', href: AuthDashboardDockerLogs() },
  { label: 'Images', href: AuthDashboardDockerImages() },
  { label: 'Networks', href: AuthDashboardDockerNetworks() },
  { label: 'Volumes', href: AuthDashboardDockerVolumes() },
  { label: 'Activity', href: AuthDashboardDockerActivity() },
  { label: 'Shell', href: AuthDashboardDockerShell() },
]

/**
 * DockerSectionTabs — section navigation for the Docker workspace.
 * Rendered once in the docker layout so every sub-page shares the same
 * navigation chrome (active pill is derived from the current path).
 * 
 * Calls usePathname() (URL data) — wrapped in Suspense so the docker
 * sub-routes keep their static shell during prerendering.
 */
export function DockerSectionTabs() {
  return (
    <Suspense fallback={null}>
      <DockerSectionTabsInner />
    </Suspense>
  )
}

function DockerSectionTabsInner() {
  const pathname = usePathname()

  return (
    <nav aria-label="Docker sections" className="flex flex-wrap items-center gap-1">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              active
                ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
