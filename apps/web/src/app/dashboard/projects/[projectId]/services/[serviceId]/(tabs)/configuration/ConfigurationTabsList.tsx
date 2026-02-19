'use client'

import { ReactElement } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Card } from '@repo/ui/components/shadcn/card'
import {
    Box,
    HardDrive,
    Network,
    Wrench,
    Cloud,
} from 'lucide-react'
import { cn } from '@repo/ui/lib/utils'
import {
    DashboardProjectsProjectIdServicesServiceIdTabsConfigurationBuild,
    DashboardProjectsProjectIdServicesServiceIdTabsConfigurationEnvironment,
    DashboardProjectsProjectIdServicesServiceIdTabsConfigurationGeneral,
    DashboardProjectsProjectIdServicesServiceIdTabsConfigurationNetwork,
    DashboardProjectsProjectIdServicesServiceIdTabsConfigurationProvider,
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
        Provider: {
            builder:
                DashboardProjectsProjectIdServicesServiceIdTabsConfigurationProvider,
            icon: Cloud,
            description: 'Provider configuration',
        },
        Build: {
            builder:
                DashboardProjectsProjectIdServicesServiceIdTabsConfigurationBuild,
            icon: Wrench,
            description: 'Build configuration',
        },
        Environment: {
            builder:
                DashboardProjectsProjectIdServicesServiceIdTabsConfigurationEnvironment,
            icon: HardDrive,
            description: 'Environment variables',
        },
        Network: {
            builder:
                DashboardProjectsProjectIdServicesServiceIdTabsConfigurationNetwork,
            icon: Network,
            description: 'Network & Traefik',
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

interface ConfigurationTabsListProps {
    projectId: string
    serviceId: string
}

export function ConfigurationTabsList({ projectId, serviceId }: ConfigurationTabsListProps) {
    const configSections = getConfigSections({ projectId, serviceId })
    const pathname = usePathname()

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
    )
}