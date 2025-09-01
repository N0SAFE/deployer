'use client'

import ServiceList from '@/components/services/ServiceList'
import { useParams } from '@/routes/hooks'
import { DashboardProjectsProjectIdTabsServices } from '@/routes/index'

export default function ProjectServicesPage() {
  const { projectId } = useParams(DashboardProjectsProjectIdTabsServices)

  return (
    <ServiceList projectId={projectId} />
  )
}