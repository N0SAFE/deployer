'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import StackList from '@/components/orchestration/StackList'
import { useParams } from '@/routes/hooks'
import { DashboardProjectsProjectIdTabs } from '@/routes'

export default function ProjectOverviewPage() {
  const params = useParams(DashboardProjectsProjectIdTabs)
  const projectId = params.projectId

  return (
    <div className="space-y-6">
      {/* Stack Management */}
      <Card>
        <CardHeader>
          <CardTitle>Stack Management</CardTitle>
          <CardDescription>
            Manage your deployment stacks and infrastructure
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StackList projectId={projectId} />
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Recent Deployments */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Deployments</CardTitle>
            <CardDescription>
              Latest deployment activity for this project
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center py-4">
              See deployments tab for detailed deployment history
            </p>
          </CardContent>
        </Card>

        {/* Service Health Summary */}
        <Card>
          <CardHeader>
            <CardTitle>Service Health</CardTitle>
            <CardDescription>
              Current status of all services
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center py-4">
              See monitoring tab for detailed health metrics
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
