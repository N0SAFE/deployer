import { Suspense } from 'react'
import { DockerRuntimeEventsProviderClient } from './_components/docker-runtime-events-provider'
import { DockerSectionTabs } from './_components/docker-section-tabs'
import { PageHeader } from '@/components/dashboard'

export default function DashboardDockerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Docker workspace"
        title="Container Operations"
        description="Monitor containers, inspect runtime health, and manage orchestration resources."
      />

      {/* DockerSectionTabs calls usePathname() (URL data) — wrap in Suspense
          so the docker sub-routes keep their static shell. The fallback is a
          tab-shaped skeleton so the shell is never blank while the pathname
          streams in. */}
      <Suspense fallback={<DockerTabsSkeleton />}>
        <DockerSectionTabs />
      </Suspense>

      <DockerRuntimeEventsProviderClient>
        <div>{children}</div>
      </DockerRuntimeEventsProviderClient>
    </div>
  )
}

/**
 * DockerTabsSkeleton — tab-bar-shaped loading state shown while the
 * pathname (URL data) streams in during prerendering.
 */
function DockerTabsSkeleton() {
  return (
    <nav aria-hidden className="flex flex-wrap items-center gap-1">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="h-8 w-24 animate-pulse rounded-md bg-muted" />
      ))}
    </nav>
  )
}
