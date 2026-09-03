import { Suspense } from 'react'
import { ProjectDetailLayoutInner } from './_components/project-detail-layout-inner'
import { ProjectDetailSkeleton } from './_components/project-detail-skeleton'
import type { ReactNode } from 'react'

/**
 * Project Detail Layout (server component)
 *
 * Shared shell for all project detail tabs. The client inner reads URL data
 * (useParams/useSelectedLayoutSegment) which suspends during prerendering on
 * dynamic routes (no generateStaticParams). The Suspense boundary lives in
 * this server component so the dashboard shell stays in the static shell —
 * the project shell streams in behind its skeleton after the URL data
 * resolves.
 */
export default function ProjectDetailLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ProjectDetailSkeleton />}>
      <ProjectDetailLayoutInner>{children}</ProjectDetailLayoutInner>
    </Suspense>
  )
}
