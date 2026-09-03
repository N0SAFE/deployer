import { Suspense } from 'react'
import { ServiceDetailLayoutInner } from './_components/service-detail-layout-inner'
import { ServiceDetailSkeleton } from './_components/service-detail-skeleton'
import type { ReactNode } from 'react'

/**
 * Service Detail Layout (server component)
 *
 * The service "namespace" shell. The client inner reads URL data
 * (useParams/useSelectedLayoutSegment) which suspends during prerendering on
 * dynamic routes. The Suspense boundary lives in this server component so the
 * dashboard shell stays in the static shell — the service shell streams in
 * behind its skeleton after the URL data resolves.
 */
export default function ServiceDetailLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ServiceDetailSkeleton />}>
      <ServiceDetailLayoutInner>{children}</ServiceDetailLayoutInner>
    </Suspense>
  )
}
