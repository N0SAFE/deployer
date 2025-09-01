'use client'

import { useParams } from 'next/navigation'
import ActivityFeed from '@/components/activity/ActivityFeed'

export default function ProjectActivityPage() {
  const params = useParams()
  const projectId = params.id as string

  return <ActivityFeed projectId={projectId} />
}