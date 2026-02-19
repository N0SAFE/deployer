'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { 
  Server, 
  Container, 
  Activity,
  Globe,
  Shield,
  BarChart3,
  Clock,
  AlertTriangle,
  Scale
} from 'lucide-react'
import StackList from '@/components/orchestration/StackList'
import { ResourceMonitoringDashboard } from '@/components/orchestration/ResourceMonitoringDashboard'

interface OrchestrationDashboardProps {
  projectId: string
}

export default function OrchestrationDashboard({ projectId }: OrchestrationDashboardProps) {
  const [activeTab, setActiveTab] = useState('stacks')

  return (
    <div className="container mx-auto py-6 px-4 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="bg-blue-100 p-2 rounded-lg">
            <Server className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Docker Orchestration Dashboard
            </h1>
            <p className="text-gray-600">
              Manage your Docker Swarm stacks, services, and deployments
            </p>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Container className="h-8 w-8 text-blue-600" />
                <div>
                  <p className="text-sm text-gray-600">Active Stacks</p>
                  <p className="text-2xl font-bold">-</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Activity className="h-8 w-8 text-green-600" />
                <div>
                  <p className="text-sm text-gray-600">Running Services</p>
                  <p className="text-2xl font-bold">-</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <BarChart3 className="h-8 w-8 text-purple-600" />
                <div>
                  <p className="text-sm text-gray-600">CPU Usage</p>
                  <p className="text-2xl font-bold">-</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-8 w-8 text-orange-600" />
                <div>
                  <p className="text-sm text-gray-600">Alerts</p>
                  <p className="text-2xl font-bold">-</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="stacks" className="flex items-center gap-2">
            <Container className="h-4 w-4" />
            Stacks
          </TabsTrigger>
          <TabsTrigger value="services" className="flex items-center gap-2">
            <Server className="h-4 w-4" />
            Services
          </TabsTrigger>
          <TabsTrigger value="domains" className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Domains
          </TabsTrigger>
          <TabsTrigger value="ssl" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            SSL
          </TabsTrigger>
          <TabsTrigger value="monitoring" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Monitoring
          </TabsTrigger>
          <TabsTrigger value="jobs" className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Jobs
          </TabsTrigger>
        </TabsList>

        {/* Stack Management Tab */}
        <TabsContent value="stacks" className="space-y-6">
          <StackList projectId={projectId} />
        </TabsContent>

        {/* Service Scaling Tab */}
        <TabsContent value="services" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Scale className="h-5 w-5" />
                Service Scaling
              </CardTitle>
              <CardDescription>
                Scale individual services across your stacks
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-sm text-gray-600 mb-4">
                  Select a stack to view and scale its services:
                </p>
                {/* Service scaling will be rendered here when a stack is selected */}
                <div className="text-center text-gray-500 py-8">
                  <Scale className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                  <h3 className="font-medium mb-2">Service Scaling</h3>
                  <p className="text-sm">
                    This will show service scaling controls for the selected stack.
                  </p>
                  <p className="text-xs text-gray-400 mt-2">
                    Coming soon: Select a stack from the Stacks tab to manage service replicas
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Domain Management Tab */}
        <TabsContent value="domains" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                Domain Management
              </CardTitle>
              <CardDescription>
                Manage domain mappings and Traefik configuration
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center text-gray-500 py-12">
                <Globe className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                <p className="text-lg font-medium">Domain Management UI</p>
                <p className="text-sm mt-1">Coming soon - Task #13</p>
                <Badge variant="outline" className="mt-4">
                  In Development
                </Badge>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SSL Management Tab */}
        <TabsContent value="ssl" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                SSL Certificate Management
              </CardTitle>
              <CardDescription>
                Monitor and manage SSL certificates
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center text-gray-500 py-12">
                <Shield className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                <p className="text-lg font-medium">SSL Management UI</p>
                <p className="text-sm mt-1">Certificate monitoring and renewal</p>
                <Badge variant="outline" className="mt-4">
                  In Development
                </Badge>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Resource Monitoring Tab */}
        <TabsContent value="monitoring" className="space-y-6">
          <ResourceMonitoringDashboard projectId={projectId} />
        </TabsContent>

        {/* Job Monitoring Tab */}
        <TabsContent value="jobs" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Job Monitoring Dashboard
              </CardTitle>
              <CardDescription>
                Monitor deployment jobs, their status, and execution logs
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center text-gray-500 py-12">
                <Clock className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                <p className="text-lg font-medium">Job Monitoring Dashboard</p>
                <p className="text-sm mt-1">Coming soon - Task #15</p>
                <Badge variant="outline" className="mt-4">
                  In Development
                </Badge>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}