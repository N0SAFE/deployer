'use client'

import { ReactElement, useState } from 'react'
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
    RotateCcw,
} from 'lucide-react'
import { cn } from '@repo/ui/lib/utils'
import { useParams } from '@/routes/hooks'
import {
    DashboardProjectsProjectIdServicesServiceIdTabsConfiguration,
    DashboardProjectsProjectIdServicesServiceIdTabsConfigurationDeployment,
    DashboardProjectsProjectIdServicesServiceIdTabsConfigurationEnvironment,
    DashboardProjectsProjectIdServicesServiceIdTabsConfigurationGeneral,
    DashboardProjectsProjectIdServicesServiceIdTabsConfigurationNetwork,
    DashboardProjectsProjectIdServicesServiceIdTabsConfigurationResources,
} from '@/routes'

const getConfigSections = ({
    projectId,
    serviceId,
}: {
    projectId: string
    serviceId: string
}) =>
    Object.entries({
        General: {
            builder:
                DashboardProjectsProjectIdServicesServiceIdTabsConfigurationGeneral,
            icon: Box,
            description: 'Basic service settings',
        },
        Environment: {
            builder:
                DashboardProjectsProjectIdServicesServiceIdTabsConfigurationEnvironment,
            icon: HardDrive,
            description: 'Environment variables',
        },
        Resources: {
            builder:
                DashboardProjectsProjectIdServicesServiceIdTabsConfigurationResources,
            icon: Server,
            description: 'Resource limits',
        },
        Deployment: {
            builder:
                DashboardProjectsProjectIdServicesServiceIdTabsConfigurationDeployment,
            icon: Key,
            description: 'Deployment settings',
        },
        Network: {
            builder:
                DashboardProjectsProjectIdServicesServiceIdTabsConfigurationNetwork,
            icon: Network,
            description: 'Network settings',
        },
    }).map(([label, { builder, icon, description }]) => ({
        label: label,
        path: builder({ projectId, serviceId }),
        link: builder.Link({
            projectId,
            serviceId,
            children: label,
            prefetch: true,
        }) as ReactElement,
        icon,
        description,
    }))

interface ServiceConfigLayoutProps {
    children: React.ReactNode
    params: {
        id: string
        serviceId: string
    }
}

export default function ServiceConfigLayout({
    children,
}: ServiceConfigLayoutProps) {
    const params = useParams(
        DashboardProjectsProjectIdServicesServiceIdTabsConfiguration
    )
    const configSections = getConfigSections({
        projectId: params.projectId,
        serviceId: params.serviceId,
    })
    const pathname = usePathname()
    const [hasUnsavedChanges] = useState(false)

    const currentSection = pathname.split('/').pop() || 'general'

    const getActiveTab = () => {
        let section = configSections.find(
            (section) => section.path === pathname
        )
        if (!section) {
            configSections.forEach((s) => {
                if (pathname.includes(s.path)) {
                    section = s
                }
            })
        }
        return section?.path || ''
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="flex items-center gap-2 text-lg font-medium">
                        <Settings className="h-5 w-5" />
                        Service Configuration
                    </h3>
                    <p className="text-muted-foreground text-sm">
                        Manage service settings, environment variables, and
                        resource limits
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {hasUnsavedChanges && (
                        <Button variant="outline" size="sm">
                            <RotateCcw className="mr-2 h-4 w-4" />
                            Reset Changes
                        </Button>
                    )}
                    <Button size="sm" disabled={!hasUnsavedChanges}>
                        <Save className="mr-2 h-4 w-4" />
                        Save Changes
                    </Button>
                </div>
            </div>

            {/* Layout with Sidebar */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
                {/* Sidebar */}
                <Card className="h-fit p-4">
                    <nav className="space-y-1">
                        {configSections.map((section) => {
                            const Icon = section.icon
                            const isActive = getActiveTab() === section.path

                            return (
                                <Link
                                    prefetch={true}
                                    key={section.path}
                                    href={section.path}
                                    className={cn(
                                        'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                                        isActive
                                            ? 'bg-primary text-primary-foreground'
                                            : 'hover:bg-muted'
                                    )}
                                >
                                    <Icon className="h-4 w-4 flex-shrink-0" />
                                    <div className="min-w-0">
                                        <div className="font-medium">
                                            {section.label}
                                        </div>
                                        <div
                                            className={cn(
                                                'truncate text-xs',
                                                isActive
                                                    ? 'text-primary-foreground/70'
                                                    : 'text-muted-foreground'
                                            )}
                                        >
                                            {section.description}
                                        </div>
                                    </div>
                                </Link>
                            )
                        })}
                    </nav>
                </Card>

                {/* Main Content */}
                <div className="lg:col-span-3">{children}</div>
            </div>
        </div>
    )
}
