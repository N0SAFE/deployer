'use client'

import { Tabs, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import {
  AuthDashboardProjectsProjectIdServicesServiceIdConfigurationEnvironment,
  AuthDashboardProjectsProjectIdServicesServiceIdConfigurationGeneral,
  AuthDashboardProjectsProjectIdServicesServiceIdConfigurationNetwork,
  AuthDashboardProjectsProjectIdServicesServiceIdConfigurationProvider,
} from '@/routes'

const sectionRoute = {
  general: {name: 'General', Route: AuthDashboardProjectsProjectIdServicesServiceIdConfigurationGeneral},
  provider: {name: 'Provider', Route: AuthDashboardProjectsProjectIdServicesServiceIdConfigurationProvider},
  network: {name: 'Network', Route: AuthDashboardProjectsProjectIdServicesServiceIdConfigurationNetwork},
  environment: {name: 'Environment', Route: AuthDashboardProjectsProjectIdServicesServiceIdConfigurationEnvironment},
} as const

interface ServiceConfigSubNavProps {
  projectId: string
  serviceId: string
  active: keyof typeof sectionRoute
}

export function ServiceConfigSubNav({ projectId, serviceId, active }: ServiceConfigSubNavProps) {
  return (
    <Tabs value={active} className="rounded-xl border border-border/60 bg-card/30 p-2">
      <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
        {Object.entries(sectionRoute).map(([section, { name, Route }]) => {
          return (
            <TabsTrigger key={section} value={section} asChild className="h-8">
              <Route.Link projectId={projectId} serviceId={serviceId}>{name}</Route.Link>
            </TabsTrigger>
          )
        })}
      </TabsList>
    </Tabs>
  )
}