'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Card } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { 
  Settings,
  Server,
  Key,
  Box,
  HardDrive,
  Network,
  Save,
  RotateCcw
} from 'lucide-react'
import { cn } from '@repo/ui/lib/utils'

const configSections = [
  {
    id: 'general',
    label: 'General',
    icon: Settings,
    description: 'Basic service settings'
  },
  {
    id: 'environment',
    label: 'Environment',
    icon: Key,
    description: 'Environment variables'
  },
  {
    id: 'build',
    label: 'Build',
    icon: Box,
    description: 'Build configuration'
  },
  {
    id: 'resources',
    label: 'Resources',
    icon: HardDrive,
    description: 'CPU, memory limits'
  },
  {
    id: 'deployment',
    label: 'Deployment',
    icon: Server,
    description: 'Deployment settings'
  },
  {
    id: 'network',
    label: 'Network',
    icon: Network,
    description: 'Networking & domains'
  }
]

interface ServiceConfigLayoutProps {
  children: React.ReactNode
  params: {
    id: string
    serviceId: string
  }
}

export default function ServiceConfigLayout({ children, params }: ServiceConfigLayoutProps) {
  const pathname = usePathname()
  const [hasUnsavedChanges] = useState(false)

  const currentSection = pathname.split('/').pop() || 'general'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Service Configuration
          </h3>
          <p className="text-sm text-muted-foreground">
            Manage service settings, environment variables, and resource limits
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasUnsavedChanges && (
            <Button variant="outline" size="sm">
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

      {/* Layout with Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar */}
        <Card className="p-4 h-fit">
          <nav className="space-y-1">
            {configSections.map((section) => {
              const Icon = section.icon
              const isActive = currentSection === section.id
              
              return (
                <Link
                  key={section.id}
                  href={`/dashboard/projects/${params.id}/services/${params.serviceId}/configuration/${section.id}`}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted'
                  )}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium">{section.label}</div>
                    <div className={cn(
                      'text-xs truncate',
                      isActive ? 'text-primary-foreground/70' : 'text-muted-foreground'
                    )}>
                      {section.description}
                    </div>
                  </div>
                </Link>
              )
            })}
          </nav>
        </Card>

        {/* Main Content */}
        <div className="lg:col-span-3">
          {children}
        </div>
      </div>
    </div>
  )
}