'use client'

import { Tabs, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import {
  AuthDashboardProjectsProjectIdServicesServiceId,
  AuthDashboardProjectsProjectIdServicesServiceIdConfiguration,
  AuthDashboardProjectsProjectIdServicesServiceIdDeployments,
  AuthDashboardProjectsProjectIdServicesServiceIdLogs,
  AuthDashboardProjectsProjectIdServicesServiceIdMonitoring,
  AuthDashboardProjectsProjectIdServicesServiceIdPreviews,
} from '@/routes'

type ServiceSection = 'overview' | 'configuration' | 'deployments' | 'logs' | 'previews' | 'monitoring'

interface ServiceSectionNavProps {
  projectId: string
  serviceId: string
  active: ServiceSection
}

const sectionLabel: Record<ServiceSection, string> = {
  overview: 'Overview',
  configuration: 'Configuration',
  deployments: 'Deployments',
  logs: 'Logs',
  previews: 'Previews',
  monitoring: 'Monitoring',
}

const sectionRoute = {
  overview: AuthDashboardProjectsProjectIdServicesServiceId,
  configuration: AuthDashboardProjectsProjectIdServicesServiceIdConfiguration,
  deployments: AuthDashboardProjectsProjectIdServicesServiceIdDeployments,
  logs: AuthDashboardProjectsProjectIdServicesServiceIdLogs,
  previews: AuthDashboardProjectsProjectIdServicesServiceIdPreviews,
  monitoring: AuthDashboardProjectsProjectIdServicesServiceIdMonitoring,
} as const

export function ServiceSectionNav({ projectId, serviceId, active }: ServiceSectionNavProps) {
  const sections: ServiceSection[] = ['overview', 'configuration', 'deployments', 'logs', 'previews', 'monitoring']

  return (
    <Tabs value={active} className="rounded-xl border border-border/60 bg-card/30 p-2">
      <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
        {sections.map((section) => {
          const SectionRoute = sectionRoute[section]

          return (
            <TabsTrigger key={section} value={section} asChild className="h-8">
              <SectionRoute.Link projectId={projectId} serviceId={serviceId}>{sectionLabel[section]}</SectionRoute.Link>
            </TabsTrigger>
          )
        })}
      </TabsList>
    </Tabs>
  )
}