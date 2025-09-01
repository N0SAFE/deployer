'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Card, CardContent } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { cn } from '@repo/ui/lib/utils'
import {
  Settings,
  KeyRound,
  Rocket,
  Shield,
  Server,
  Bell,
  Save,
  RotateCcw,
  Globe,
} from 'lucide-react'
import Link from 'next/link'

interface ProjectConfigurationLayoutProps {
  children: React.ReactNode
  params: {
    projectId: string
  }
}

const configSections = [
  {
    id: 'general',
    label: 'General',
    icon: Settings,
    description: 'Basic project settings and information',
    href: (projectId: string) => `/dashboard/projects/${projectId}/configuration/general`,
  },
  {
    id: 'environments',
    label: 'Environments',
    icon: Globe,
    description: 'Manage deployment environments and their configurations',
    href: (projectId: string) => `/dashboard/projects/${projectId}/configuration/environments`,
  },
  {
    id: 'environment',
    label: 'Environment Variables',
    icon: KeyRound,
    description: 'Manage environment variables for all environments',
    href: (projectId: string) => `/dashboard/projects/${projectId}/configuration/environment`,
  },
  {
    id: 'deployment',
    label: 'Deployment',
    icon: Rocket,
    description: 'Deployment strategies and automation settings',
    href: (projectId: string) => `/dashboard/projects/${projectId}/configuration/deployment`,
  },
  {
    id: 'security',
    label: 'Security',
    icon: Shield,
    description: 'Security policies and access control',
    href: (projectId: string) => `/dashboard/projects/${projectId}/configuration/security`,
  },
  {
    id: 'resources',
    label: 'Resources',
    icon: Server,
    description: 'Default resource limits and scaling policies',
    href: (projectId: string) => `/dashboard/projects/${projectId}/configuration/resources`,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: Bell,
    description: 'Email, Slack, and other notification settings',
    href: (projectId: string) => `/dashboard/projects/${projectId}/configuration/notifications`,
  },
]

export default function ProjectConfigurationLayout({ 
  children, 
  params 
}: ProjectConfigurationLayoutProps) {
  const pathname = usePathname()
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Determine active section from pathname
  const getActiveSection = () => {
    const basePath = `/dashboard/projects/${params.projectId}/configuration`
    if (pathname === basePath || pathname === `${basePath}/general`) return 'general'
    if (pathname.startsWith(`${basePath}/environments`)) return 'environments'
    if (pathname.startsWith(`${basePath}/environment`)) return 'environment'
    if (pathname.startsWith(`${basePath}/deployment`)) return 'deployment'
    if (pathname.startsWith(`${basePath}/security`)) return 'security'
    if (pathname.startsWith(`${basePath}/resources`)) return 'resources'
    if (pathname.startsWith(`${basePath}/notifications`)) return 'notifications'
    return 'general'
  }

  const activeSection = getActiveSection()
  const currentSection = configSections.find(section => section.id === activeSection)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Project Configuration
          </h3>
          <p className="text-sm text-muted-foreground">
            {currentSection?.description || 'Manage project settings and configuration'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasUnsavedChanges && (
            <Button variant="outline" size="sm" onClick={() => setHasUnsavedChanges(false)}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset Changes
            </Button>
          )}
          <Button size="sm" disabled={!hasUnsavedChanges}>
            <Save className="h-4 w-4 mr-2" />
            Save Changes
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Sidebar Navigation */}
        <div className="lg:col-span-3">
          <Card>
            <CardContent className="p-4">
              <nav className="space-y-1">
                {configSections.map((section) => {
                  const Icon = section.icon
                  const isActive = activeSection === section.id
                  
                  return (
                    <Link
                      key={section.id}
                      href={section.href(params.projectId)}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {section.label}
                    </Link>
                  )
                })}
              </nav>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <div className="lg:col-span-9">
          {children}
        </div>
      </div>
    </div>
  )
}