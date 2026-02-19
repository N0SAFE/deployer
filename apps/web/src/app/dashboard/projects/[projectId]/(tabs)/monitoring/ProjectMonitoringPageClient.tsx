'use client'

import { Activity, BarChart3, Server, Shield } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { ResourceMonitoringDashboard } from '@/components/orchestration/ResourceMonitoringDashboard'
import SystemHealthDashboard from '@/components/orchestration/SystemHealthDashboard'
import { useParams } from '@/routes/hooks'
import { DashboardProjectsProjectIdTabsMonitoring } from '@/routes'

export default function ProjectMonitoringPageClient() {
  const params = useParams(DashboardProjectsProjectIdTabsMonitoring)
  
  return (
    <div className="space-y-6">
      <Tabs defaultValue="resources" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="resources" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Resource Monitoring
          </TabsTrigger>
          <TabsTrigger value="health" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            System Health
          </TabsTrigger>
        </TabsList>

        <TabsContent value="resources" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Resources</CardTitle>
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">2.4 GB</div>
                <p className="text-xs text-muted-foreground">
                  Memory across all services
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">CPU Usage</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">0.8 CPU</div>
                <p className="text-xs text-muted-foreground">
                  Total CPU allocation
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Storage</CardTitle>
                <Server className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">12 GB</div>
                <p className="text-xs text-muted-foreground">
                  Total storage used
                </p>
              </CardContent>
            </Card>
          </div>

          <ResourceMonitoringDashboard projectId={params.projectId} />
        </TabsContent>

        <TabsContent value="health" className="space-y-6">
          <SystemHealthDashboard projectId={params.projectId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}