'use client'

import JobManagementInterface from '@/components/orchestration/JobManagementInterface'
import { useParams } from 'next/navigation'
import { Briefcase } from 'lucide-react'

export default function ProjectJobsPage() {
  const params = useParams() as { projectId: string }
  const projectId = params.projectId

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium flex items-center gap-2">
            <Briefcase className="h-5 w-5" />
            Job Management
          </h3>
          <p className="text-sm text-muted-foreground">
            Monitor and manage deployment jobs, background tasks, and scheduled operations
          </p>
        </div>
      </div>

      {/* Job Management Interface */}
      <JobManagementInterface projectId={projectId} />
    </div>
  )
}