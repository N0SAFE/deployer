'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/shadcn/dialog'
import { 
  Plus,
  Zap,
  Settings,
  Users,
  Globe,
  GitBranch,
  ExternalLink
} from 'lucide-react'
import ProjectDetailPage from '../project/ProjectDetailPage'
import ServiceForm from '../service-management/ServiceForm'
import DeploymentSourceForm from '../deployment-config/DeploymentSourceForm'
import TeamManagement from '../team-management/TeamManagement'
import { type Service } from '@/state/serviceStore'

interface DeploymentConfig {
  serviceId: string
  environment: 'production' | 'preview' | 'development'
  sourceType: 'git' | 'upload'
  sourceConfig: {
    repository?: string
    branch?: string
    gitProvider?: 'github' | 'gitlab' | 'git'
    fileName?: string
    fileSize?: number
  }
  buildCommand?: string
  startCommand?: string
  dockerfilePath?: string
  environmentVariables: Array<{
    key: string
    value: string
    isSecret: boolean
  }>
  previewConfig?: {
    enabled: boolean
    baseDomain: string
    subdomain?: string
    customDomain?: string
    shareEnvVars: boolean
  }
}

// Mock data for demonstration
const mockTeamMembers = [
  {
    id: 'user-1',
    name: 'John Doe',
    email: 'john@example.com',
    role: 'owner' as const,
    avatar: '',
    joinedAt: new Date('2024-01-15'),
    lastActive: new Date(Date.now() - 1000 * 60 * 30) // 30 minutes ago
  },
  {
    id: 'user-2',
    name: 'Jane Smith',
    email: 'jane@example.com',
    role: 'developer' as const,
    avatar: '',
    joinedAt: new Date('2024-01-20'),
    lastActive: new Date(Date.now() - 1000 * 60 * 60 * 2) // 2 hours ago
  },
  {
    id: 'user-3',
    name: 'Bob Wilson',
    email: 'bob@example.com',
    role: 'viewer' as const,
    avatar: '',
    joinedAt: new Date('2024-02-01'),
    lastActive: new Date(Date.now() - 1000 * 60 * 60 * 24) // 1 day ago
  }
]

interface ProjectDashboardProps {
  projectId: string
}

export default function ProjectDashboard({ projectId }: ProjectDashboardProps) {
  const [isServiceFormOpen, setIsServiceFormOpen] = useState(false)
  const [isDeployFormOpen, setIsDeployFormOpen] = useState(false)
  const [isTeamManagementOpen, setIsTeamManagementOpen] = useState(false)
  const [editingService, setEditingService] = useState<Service | undefined>()

  const handleCreateService = async (serviceData: Partial<Service>) => {
    console.log('Creating service:', serviceData)
    // TODO: Implement service creation
    setIsServiceFormOpen(false)
    setEditingService(undefined)
  }

  const handleDeploy = async (deploymentConfig: DeploymentConfig) => {
    console.log('Starting deployment:', deploymentConfig)
    // TODO: Implement deployment
    setIsDeployFormOpen(false)
  }

  const handleInviteMember = async (email: string, role: string) => {
    console.log('Inviting member:', email, role)
    // TODO: Implement team invitation
  }

  const handleUpdateRole = async (memberId: string, role: string) => {
    console.log('Updating role:', memberId, role)
    // TODO: Implement role update
  }

  const handleRemoveMember = async (memberId: string) => {
    console.log('Removing member:', memberId)
    // TODO: Implement member removal
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Quick Actions Bar */}
      <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-blue-900">Quick Actions</h3>
              <p className="text-blue-700">Get started with your universal deployment platform</p>
            </div>
            <div className="flex space-x-3">
              <Dialog open={isServiceFormOpen} onOpenChange={setIsServiceFormOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="bg-white hover:bg-blue-50">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Service
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Create New Service</DialogTitle>
                    <DialogDescription>
                      Add a new service to your project with custom configuration
                    </DialogDescription>
                  </DialogHeader>
                  <ServiceForm
                    projectId={projectId}
                    service={editingService}
                    onSubmit={handleCreateService}
                    onCancel={() => {
                      setIsServiceFormOpen(false)
                      setEditingService(undefined)
                    }}
                    isEditing={!!editingService}
                  />
                </DialogContent>
              </Dialog>

              <Dialog open={isDeployFormOpen} onOpenChange={setIsDeployFormOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-blue-600 hover:bg-blue-700">
                    <Zap className="h-4 w-4 mr-2" />
                    Deploy
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Deploy Service</DialogTitle>
                    <DialogDescription>
                      Configure and start a new deployment from multiple sources
                    </DialogDescription>
                  </DialogHeader>
                  <DeploymentSourceForm
                    serviceId="service-1"
                    onSubmit={handleDeploy}
                    onCancel={() => setIsDeployFormOpen(false)}
                  />
                </DialogContent>
              </Dialog>

              <Dialog open={isTeamManagementOpen} onOpenChange={setIsTeamManagementOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="bg-white hover:bg-blue-50">
                    <Users className="h-4 w-4 mr-2" />
                    Team
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Team Management</DialogTitle>
                    <DialogDescription>
                      Manage team members and their roles for this project
                    </DialogDescription>
                  </DialogHeader>
                  <TeamManagement
                    projectId={projectId}
                    members={mockTeamMembers}
                    currentUserId="user-1"
                    onInviteMember={handleInviteMember}
                    onUpdateRole={handleUpdateRole}
                    onRemoveMember={handleRemoveMember}
                  />
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Platform Features Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <GitBranch className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Multi-Source Deploy</p>
                <p className="font-semibold">GitHub, GitLab, ZIP</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Globe className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Preview Deployments</p>
                <p className="font-semibold">Auto Domains</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Zap className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Service Dependencies</p>
                <p className="font-semibold">Auto Orchestration</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-orange-100 rounded-lg">
                <Users className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Team Collaboration</p>
                <p className="font-semibold">Role-Based Access</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Project Detail Page */}
      <ProjectDetailPage projectId={projectId} />

      {/* Platform Information */}
      <Card className="bg-gradient-to-r from-gray-50 to-gray-100 border-gray-200">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Zap className="h-5 w-5 text-gray-700" />
            <span>Universal Deployment Platform</span>
          </CardTitle>
          <CardDescription>
            Similar to Dokploy - Deploy applications from multiple sources with preview environments and team collaboration
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-2">
              <h4 className="font-semibold text-gray-800">Multi-Source Deployments</h4>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• GitHub repositories</li>
                <li>• GitLab integration</li>
                <li>• Direct Git URLs</li>
                <li>• ZIP file uploads</li>
                <li>• Docker images</li>
              </ul>
            </div>

            <div className="space-y-2">
              <h4 className="font-semibold text-gray-800">Preview Environments</h4>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• Auto-generated subdomains</li>
                <li>• Custom domain configuration</li>
                <li>• Environment variable sharing</li>
                <li>• Branch-based deployments</li>
                <li>• SSL certificates</li>
              </ul>
            </div>

            <div className="space-y-2">
              <h4 className="font-semibold text-gray-800">Service Orchestration</h4>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• Service dependencies</li>
                <li>• Auto deployment order</li>
                <li>• Health checks</li>
                <li>• Load balancing</li>
                <li>• Resource limits</li>
              </ul>
            </div>
          </div>

          <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-200">
            <div className="flex items-center space-x-2">
              <Badge variant="outline" className="bg-white">
                <ExternalLink className="h-3 w-3 mr-1" />
                Self-Hosted
              </Badge>
              <Badge variant="outline" className="bg-white">
                <Settings className="h-3 w-3 mr-1" />
                VPS Ready
              </Badge>
            </div>
            <p className="text-sm text-gray-500">
              Install on any VPS • Docker-based • Traefik integration
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}