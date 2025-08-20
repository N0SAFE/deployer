'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { Button } from '@repo/ui/components/shadcn/button'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Separator } from '@repo/ui/components/shadcn/separator'
import { 
  Settings, 
  Users, 
  GitBranch, 
  Zap,
  Plus,
  ExternalLink,
  Globe
} from 'lucide-react'
import ServiceCard from '../services/ServiceCard'
import DeploymentCard from '../deployments/DeploymentCard'
import ActivityFeed from '../activity/ActivityFeed'

import { type Service } from '@/state/serviceStore'
import { type Deployment } from '@/state/deploymentStore'

interface ProjectDetailPageProps {
  projectId: string
}

// Mock project data
const mockProject = {
  id: 'project-1',
  name: 'E-commerce Platform',
  description: 'Modern full-stack e-commerce platform with React and Node.js',
  status: 'active' as const,
  repository: 'https://github.com/company/ecommerce-platform',
  domain: 'ecommerce.example.com',
  environmentVariables: {
    NODE_ENV: 'production',
    DATABASE_URL: '***',
    API_KEY: '***'
  },
  collaborators: [
    { id: '1', name: 'John Doe', email: 'john@example.com', role: 'owner' },
    { id: '2', name: 'Jane Smith', email: 'jane@example.com', role: 'developer' },
    { id: '3', name: 'Bob Wilson', email: 'bob@example.com', role: 'viewer' }
  ],
  createdAt: new Date('2024-01-15'),
  updatedAt: new Date()
}

// Mock services data
const mockServices: Service[] = [
  {
    id: 'service-1',
    name: 'API Backend',
    description: 'Backend API service for the e-commerce platform',
    projectId: 'project-1',
    dockerfilePath: './Dockerfile.api',
    buildArgs: { 'NODE_ENV': 'production' },
    envVars: { 'NODE_ENV': 'production', 'PORT': '3000' },
    subdomain: 'api',
    customDomain: null,
    port: 3000,
    healthCheckPath: '/health',
    cpuLimit: '0.5',
    memoryLimit: '512M',
    isEnabled: true,
    createdAt: new Date('2024-01-15'),
    updatedAt: new Date(),
    status: 'running' as const,
    currentDeploymentId: 'deploy-1',
    lastDeploymentAt: new Date(Date.now() - 1000 * 60 * 30)
  },
  {
    id: 'service-2',
    name: 'Web Frontend',
    description: 'React frontend for the e-commerce platform',
    projectId: 'project-1',
    dockerfilePath: './Dockerfile.web',
    buildArgs: { 'NODE_ENV': 'production' },
    envVars: { 'NEXT_PUBLIC_API_URL': 'https://api.example.com', 'PORT': '3001' },
    subdomain: 'www',
    customDomain: null,
    port: 3001,
    healthCheckPath: '/',
    cpuLimit: '0.5',
    memoryLimit: '512M',
    isEnabled: true,
    createdAt: new Date('2024-01-15'),
    updatedAt: new Date(),
    status: 'running' as const,
    currentDeploymentId: 'deploy-2',
    lastDeploymentAt: new Date(Date.now() - 1000 * 60 * 15)
  }
]

// Mock deployments data  
const mockDeployments: Deployment[] = [
  {
    id: 'deploy-1',
    serviceId: 'service-1',
    environment: 'production' as const,
    status: 'success' as const,
    sourceType: 'git' as const,
    sourceConfig: {
      repository: 'https://github.com/company/ecommerce-platform',
      branch: 'main',
      commit: 'a1b2c3d4'
    },
    buildLogs: 'Build completed successfully',
    deploymentLogs: 'Deployment completed',
    imageTag: 'api-backend:v1.2.3',
    containerId: 'container-api-1',
    traefikRuleId: 'rule-api-1',
    url: 'https://api.example.com',
    triggeredById: 'user-1',
    createdAt: new Date(Date.now() - 1000 * 60 * 35),
    startedAt: new Date(Date.now() - 1000 * 60 * 32),
    completedAt: new Date(Date.now() - 1000 * 60 * 30),
    duration: 120,
    progress: 100
  },
  {
    id: 'deploy-2',
    serviceId: 'service-2',
    environment: 'production' as const,
    status: 'building' as const,
    sourceType: 'git' as const,
    sourceConfig: {
      repository: 'https://github.com/company/ecommerce-platform',
      branch: 'main',
      commit: 'e5f6g7h8'
    },
    buildLogs: 'Build in progress...',
    deploymentLogs: null,
    imageTag: null,
    containerId: null,
    traefikRuleId: null,
    url: null,
    triggeredById: 'user-2',
    createdAt: new Date(Date.now() - 1000 * 60 * 20),
    startedAt: new Date(Date.now() - 1000 * 60 * 17),
    completedAt: null,
    duration: undefined,
    progress: 65
  }
]

export default function ProjectDetailPage({ projectId }: ProjectDetailPageProps) {
  // TODO: Use projectId to fetch real project data
  console.log('Project ID:', projectId)
  const project = mockProject
  const services = mockServices
  const deployments = mockDeployments

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'default'
      case 'inactive':
        return 'secondary'
      case 'error':
        return 'destructive'
      default:
        return 'outline'
    }
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Project Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="flex items-center space-x-3">
            <h1 className="text-3xl font-bold">{project.name}</h1>
            <Badge variant={getStatusColor(project.status) as "default" | "destructive" | "outline" | "secondary"}>
              {project.status}
            </Badge>
          </div>
          <p className="text-muted-foreground max-w-2xl">
            {project.description}
          </p>
          <div className="flex items-center space-x-4 text-sm text-muted-foreground">
            <div className="flex items-center space-x-1">
              <GitBranch className="h-4 w-4" />
              <a 
                href={project.repository}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground"
              >
                Repository
                <ExternalLink className="h-3 w-3 ml-1 inline" />
              </a>
            </div>
            <div className="flex items-center space-x-1">
              <Globe className="h-4 w-4" />
              <a 
                href={`https://${project.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground"
              >
                {project.domain}
                <ExternalLink className="h-3 w-3 ml-1 inline" />
              </a>
            </div>
          </div>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline" size="sm">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
          <Button size="sm">
            <Zap className="h-4 w-4 mr-2" />
            Deploy
          </Button>
        </div>
      </div>

      <Separator />

      {/* Main Content Tabs */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="services">Services ({services.length})</TabsTrigger>
          <TabsTrigger value="deployments">Deployments</TabsTrigger>
          <TabsTrigger value="team">Team ({project.collaborators.length})</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Services Overview */}
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Services</h2>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Service
                </Button>
              </div>
              <div className="grid gap-4">
                {services.map((service) => (
                  <ServiceCard key={service.id} service={service} />
                ))}
              </div>
            </div>

            {/* Activity Feed */}
            <div className="space-y-4">
              <ActivityFeed projectId={project.id} />
            </div>
          </div>

          {/* Recent Deployments */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Recent Deployments</h2>
            <div className="grid gap-4">
              {deployments.slice(0, 3).map((deployment) => (
                <DeploymentCard key={deployment.id} deployment={deployment} />
              ))}
            </div>
          </div>
        </TabsContent>

        {/* Services Tab */}
        <TabsContent value="services" className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Project Services</h2>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Service
            </Button>
          </div>
          <div className="grid gap-4">
            {services.map((service) => (
              <ServiceCard key={service.id} service={service} />
            ))}
          </div>
        </TabsContent>

        {/* Deployments Tab */}
        <TabsContent value="deployments" className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Deployment History</h2>
            <Button>
              <Zap className="h-4 w-4 mr-2" />
              New Deployment
            </Button>
          </div>
          <div className="grid gap-4">
            {deployments.map((deployment) => (
              <DeploymentCard key={deployment.id} deployment={deployment} />
            ))}
          </div>
        </TabsContent>

        {/* Team Tab */}
        <TabsContent value="team" className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Team Members</h2>
            <Button>
              <Users className="h-4 w-4 mr-2" />
              Invite Member
            </Button>
          </div>
          <Card>
            <CardContent className="p-6">
              <div className="space-y-4">
                {project.collaborators.map((collaborator) => (
                  <div key={collaborator.id} className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <span className="text-sm font-medium">
                          {collaborator.name.split(' ').map(n => n[0]).join('')}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium">{collaborator.name}</p>
                        <p className="text-sm text-muted-foreground">{collaborator.email}</p>
                      </div>
                    </div>
                    <Badge variant="outline">{collaborator.role}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-6">
          <h2 className="text-xl font-semibold">Project Settings</h2>
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>General</CardTitle>
                <CardDescription>Basic project configuration</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Project settings interface will be implemented here
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Environment Variables</CardTitle>
                <CardDescription>Manage project environment variables</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Environment variables management interface will be implemented here
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}