'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Alert, AlertDescription } from '@repo/ui/components/shadcn/alert'
import { OrganizationDomainManagement } from '@/components/domains/OrganizationDomainManagement'
import { useActiveOrganization, useOrganizations } from '@/hooks/useTeams'
import { Globe, Building2, AlertCircle, Info } from 'lucide-react'

export default function OrganizationDomainsPage() {
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
              Organization Domain Management
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
              Organization Domain Management
            </h3>
            <p className="text-sm text-muted-foreground">
              Manage custom domains for your organization
            </p>
          </div>
        </div>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            You need to select an organization to manage domains. Please select or create an organization from the sidebar.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Personal Workspace
            </CardTitle>
            <CardDescription>
              Domain management is only available for organizations
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Organizations allow you to manage domains that can be shared across multiple projects.
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
            Organization Domain Management
          </h3>
          <p className="text-sm text-muted-foreground">
            Manage custom domains for {activeOrg.name}
          </p>
        </div>
        <Badge variant="outline" className="gap-1">
          <Building2 className="h-3 w-3" />
          {activeOrg.name}
        </Badge>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Add and verify domains at the organization level. Once verified, these domains can be assigned to projects and services.
        </AlertDescription>
      </Alert>

      {/* Organization Domain Management Component */}
      <OrganizationDomainManagement organizationId={activeOrg.id} />

      {/* Domain Hierarchy Info */}
      <Card>
        <CardHeader>
          <CardTitle>Domain Management Hierarchy</CardTitle>
          <CardDescription>
            Understanding the multi-level domain system
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="bg-primary/10 p-2 rounded-lg mt-0.5">
                <Building2 className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-medium mb-1">1. Organization Level</h4>
                <p className="text-sm text-muted-foreground">
                  Add and verify domains at the organization level. These domains become available for all projects within the organization.
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="bg-blue-100 p-2 rounded-lg mt-0.5">
                <Globe className="h-4 w-4 text-blue-600" />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-medium mb-1">2. Project Level</h4>
                <p className="text-sm text-muted-foreground">
                  Assign organization domains to specific projects. Each project can use one or more verified domains.
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="bg-green-100 p-2 rounded-lg mt-0.5">
                <Globe className="h-4 w-4 text-green-600" />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-medium mb-1">3. Service Level</h4>
                <p className="text-sm text-muted-foreground">
                  Map project domains to individual services with optional subdomains and custom paths for fine-grained routing control.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
