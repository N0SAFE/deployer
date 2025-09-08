'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useParams } from '@/routes/hooks'
import { DashboardProjectsProjectIdServicesServiceIdTabsConfiguration } from '@/routes'

export default function ServiceConfigurationPage() {
  const params = useParams(DashboardProjectsProjectIdServicesServiceIdTabsConfiguration)
  const router = useRouter()

  useEffect(() => {
    // Redirect to general configuration by default
    router.replace(`/dashboard/projects/${params.projectId}/services/${params.serviceId}/configuration/general`)
  }, [router, params.projectId, params.serviceId])

  return (
    <div className="flex h-96 items-center justify-center">
      <p className="text-muted-foreground">Redirecting...</p>
    </div>
  )
}