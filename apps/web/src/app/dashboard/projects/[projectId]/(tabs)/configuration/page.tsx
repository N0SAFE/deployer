'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface ProjectConfigurationPageProps {
  params: {
    projectId: string
  }
}

export default function ProjectConfigurationPage({ params }: ProjectConfigurationPageProps) {
  const router = useRouter()

  useEffect(() => {
    // Redirect to general configuration by default
    router.replace(`/dashboard/projects/${params.projectId}/configuration/general`)
  }, [router, params.projectId])

  return (
    <div className="flex h-96 items-center justify-center">
      <p className="text-muted-foreground">Redirecting...</p>
    </div>
  )
}