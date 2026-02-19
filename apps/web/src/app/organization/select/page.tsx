'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Plus, Loader2 } from 'lucide-react'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { useOrganizations, useActiveOrganization, useSetActiveOrganization } from '@/hooks/useTeams'
import CreateOrganizationDialog from '@/components/organization/CreateOrganizationDialog'

export default function OrganizationSelectPage() {
  const router = useRouter()
  const { data: organizations = [], isLoading: organizationsLoading } = useOrganizations()
  const { data: activeOrg, isPending: activeOrgLoading } = useActiveOrganization()
  const setActiveOrganization = useSetActiveOrganization()
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null)

  // Redirect if user already has an active organization
  useEffect(() => {
    if (!activeOrgLoading && activeOrg) {
      router.push('/dashboard')
    }
  }, [activeOrg, activeOrgLoading, router])

  const handleSelectOrganization = async (organizationId: string) => {
    setSelectedOrgId(organizationId)
    try {
      await setActiveOrganization.mutateAsync({ organizationId })
      router.push('/dashboard')
    } catch (error) {
      console.error('Failed to set active organization:', error)
      setSelectedOrgId(null)
    }
  }

  if (organizationsLoading || activeOrgLoading || selectedOrgId !== null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">
            {selectedOrgId ? 'Setting active organization...' : 'Loading organizations...'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-muted/20">
      <div className="w-full max-w-4xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Select an Organization</h1>
          <p className="text-muted-foreground">
            Choose an organization to continue
          </p>
        </div>

        {/* Organizations List */}
        {organizations.length > 0 ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Your Organizations</h2>
              <CreateOrganizationDialog>
                <Button variant="outline" size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Organization
                </Button>
              </CreateOrganizationDialog>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {organizations.map((org) => (
                <Card
                  key={org.id}
                  className="border-2 hover:border-primary/50 transition-colors cursor-pointer relative"
                  onClick={() => handleSelectOrganization(org.id)}
                >
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                        {selectedOrgId === org.id ? (
                          <Loader2 className="h-6 w-6 text-primary animate-spin" />
                        ) : (
                          <Building2 className="h-6 w-6 text-primary" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="truncate">{org.name}</CardTitle>
                        <CardDescription className="truncate">
                          {org.slug}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </div>
        ) : (
          /* Create Organization CTA */
          <Card className="border-dashed">
            <CardHeader className="text-center">
              <CardTitle>No Organizations Yet</CardTitle>
              <CardDescription>
                Create an organization to get started
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center pb-6">
              <CreateOrganizationDialog>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Your First Organization
                </Button>
              </CreateOrganizationDialog>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
