'use client'

import { useParams } from 'next/navigation'
import DependencyGraphClient from './DependencyGraphClient'

export default function ProjectDependenciesPage() {
  const params = useParams()
  const projectId = params.projectId as string

  return <DependencyGraphClient projectId={projectId} />
}