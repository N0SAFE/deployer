'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Alert, AlertDescription } from '@repo/ui/components/shadcn/alert'
import { Button } from '@repo/ui/components/shadcn/button'
import { ProjectDomainSelector } from '@/components/domains/ProjectDomainSelector'
import { useParams } from '@/routes/hooks'
import { DashboardProjectsProjectIdTabsDomains, DashboardDomains } from '@/routes'
import { useProject } from '@/hooks/useProjects'
import { useActiveOrganization, useOrganizations } from '@/hooks/useTeams'
import { Globe, Building2, AlertCircle, ArrowRight, ExternalLink } from 'lucide-react'
import Link from 'next/link'

export default function ProjectDomainsPage() {
  const params = useParams(DashboardProjectsProjectIdTabsDomains)
  const projectId = params.projectId
  const { data: project } = useProject(projectId)
  const { data: activeOrg, isPending: isActiveOrgPending } = useActiveOrganization()
  const { isLoading: isOrgsLoading } = useOrganizations()

  // Show loading state while organizations are being fetched or auto-selected
  if (isActiveOrgPending || isOrgsLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Project Domain Management
            </h3>
            <p className="text-sm text-muted-foreground">
              Loading organization data...
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!activeOrg) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Project Domain Management
            </h3>
            <p className="text-sm text-muted-foreground">
              Assign domains to this project
            </p>
          </div>
        </div>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Domain management requires an organization. Please select or create an organization from the sidebar.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Organization Required
            </CardTitle>
            <CardDescription>
              Projects must belong to an organization to use custom domains
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Organizations allow you to manage domains centrally and assign them to projects as needed.
              Create or select an organization to get started with domain management.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Project Domain Management
          </h3>
          <p className="text-sm text-muted-foreground">
            Assign and manage domains for {project?.name || 'this project'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <Building2 className="h-3 w-3" />
            {activeOrg.name}
          </Badge>
          <Link href={DashboardDomains()}>
            <Button variant="outline" size="sm" className="gap-2">
              Manage Org Domains
              <ExternalLink className="h-3 w-3" />
            </Button>
          </Link>
        </div>
      </div>

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription className="flex items-center justify-between">
          <span>
            Domains must be added and verified at the organization level before they can be assigned to projects.
          </span>
          <Link href={DashboardDomains()}>
            <Button variant="ghost" size="sm" className="gap-2">
              Add Organization Domains
              <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
        </AlertDescription>
      </Alert>

      {/* Project Domain Selector Component */}
      <ProjectDomainSelector 
        projectId={projectId} 
        organizationId={activeOrg.id} 
      />

      {/* Domain Configuration Guide */}
      <Card>
        <CardHeader>
          <CardTitle>Domain Assignment Guide</CardTitle>
          <CardDescription>
            How to use domains in this project
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="bg-primary/10 p-2 rounded-lg mt-0.5">
                <Building2 className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-medium mb-1">1. Organization Domains</h4>
                <p className="text-sm text-muted-foreground">
                  Domains are added and verified at the organization level. Visit the organization domains page to add new domains.
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="bg-blue-100 p-2 rounded-lg mt-0.5">
                <Globe className="h-4 w-4 text-blue-600" />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-medium mb-1">2. Assign to Project</h4>
                <p className="text-sm text-muted-foreground">
                  Select which verified organization domains this project can use. You can assign multiple domains to a single project.
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="bg-green-100 p-2 rounded-lg mt-0.5">
                <Globe className="h-4 w-4 text-green-600" />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-medium mb-1">3. Map to Services</h4>
                <p className="text-sm text-muted-foreground">
                  Once assigned to the project, domains can be mapped to individual services with custom subdomains and paths in the service network configuration.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}