'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface ServiceConfigurationPageProps {
  params: {
    id: string
    serviceId: string
  }
}

export default function ServiceConfigurationPage({ params }: ServiceConfigurationPageProps) {
  const router = useRouter()

  useEffect(() => {
    // Redirect to general configuration by default
    router.replace(`/dashboard/projects/${params.id}/services/${params.serviceId}/configuration/general`)
  }, [router, params.id, params.serviceId])

  return (
    <div className="flex h-96 items-center justify-center">
      <p className="text-muted-foreground">Redirecting...</p>
    </div>
  )
}