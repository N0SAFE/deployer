'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import DomainMappingCard from '@/components/orchestration/DomainMappingCard'
import { useParams } from '@/routes/hooks'
import { DashboardProjectsProjectIdTabsDomains } from '@/routes'
import { useProject } from '@/hooks/useProjects'
import { Globe } from 'lucide-react'

export default function ProjectDomainsPage() {
  const params = useParams(DashboardProjectsProjectIdTabsDomains)
  const projectId = params.projectId
  const { data: project } = useProject(projectId)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Domain Management
          </h3>
          <p className="text-sm text-muted-foreground">
            Manage custom domains and domain mappings for your services
          </p>
        </div>
      </div>

      {/* Domain Mapping Management */}
      <DomainMappingCard 
        stackId={projectId} 
        stackName={project?.name || 'Project Stack'} 
      />

      {/* Domain Configuration Info */}
      <Card>
        <CardHeader>
          <CardTitle>Domain Configuration Guide</CardTitle>
          <CardDescription>
            How to configure custom domains for your services
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div>
              <h4 className="text-sm font-medium mb-1">1. Add Your Domain</h4>
              <p className="text-sm text-muted-foreground">
                Add your custom domain to the domain mappings above
              </p>
            </div>
            <div>
              <h4 className="text-sm font-medium mb-1">2. Configure DNS</h4>
              <p className="text-sm text-muted-foreground">
                Point your domain&apos;s DNS to the provided CNAME or A record
              </p>
            </div>
            <div>
              <h4 className="text-sm font-medium mb-1">3. SSL Certificate</h4>
              <p className="text-sm text-muted-foreground">
                SSL certificates will be automatically provisioned once DNS is configured
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}