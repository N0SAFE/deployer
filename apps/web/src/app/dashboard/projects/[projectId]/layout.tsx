import { Suspense } from 'react'
import { ProjectDetailLayoutInner } from './_components/project-detail-layout-inner'
import { ProjectDetailSkeleton } from './_components/project-detail-skeleton'
import type { ReactNode } from 'react'
import type { Metadata } from 'next'

// Metadata lives in the layout: the project pages are client components, and
// `metadata` cannot be exported from a `'use client'` file. The project's own
// name is fetched client-side, so the title stays the generic section name.
export const metadata: Metadata = {
  title: 'Project',
  description: 'Services, environments, domains and deployments for this project',
}

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
