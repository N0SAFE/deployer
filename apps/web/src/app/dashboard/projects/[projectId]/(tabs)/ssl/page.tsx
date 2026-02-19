'use client'

import SslCertificateDashboard from '@/components/orchestration/SslCertificateDashboard'
import { DashboardProjectsProjectIdTabsSsl } from '@/routes'
import { useParams } from '@/routes/hooks'
import { Shield } from 'lucide-react'

export default function ProjectSslPage() {
  const params = useParams(DashboardProjectsProjectIdTabsSsl)
  const projectId = params.projectId

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium flex items-center gap-2">
            <Shield className="h-5 w-5" />
            SSL Certificate Management
          </h3>
          <p className="text-sm text-muted-foreground">
            Manage SSL certificates for your domains and ensure secure connections
          </p>
        </div>
      </div>

      {/* SSL Certificate Dashboard */}
      <SslCertificateDashboard projectId={projectId} />
    </div>
  )
}