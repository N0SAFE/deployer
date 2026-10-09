'use client'

import {
  AuthDashboardProjectsProjectIdServicesServiceIdConfigurationEnvironment,
  AuthDashboardProjectsProjectIdServicesServiceIdConfigurationGeneral,
  AuthDashboardProjectsProjectIdServicesServiceIdConfigurationNetwork,
  AuthDashboardProjectsProjectIdServicesServiceIdConfigurationPreview,
  AuthDashboardProjectsProjectIdServicesServiceIdConfigurationProvider,
} from '@/routes'
import { cn } from '@/lib/utils'
import { SlidersHorizontal, Puzzle, Network, KeyRound, Rocket } from 'lucide-react'

const sectionRoute = [
  { key: 'general', name: 'General', icon: SlidersHorizontal, Route: AuthDashboardProjectsProjectIdServicesServiceIdConfigurationGeneral },
  { key: 'provider', name: 'Source & build', icon: Puzzle, Route: AuthDashboardProjectsProjectIdServicesServiceIdConfigurationProvider },
  { key: 'environment', name: 'Variables', icon: KeyRound, Route: AuthDashboardProjectsProjectIdServicesServiceIdConfigurationEnvironment },
  { key: 'network', name: 'Network & domains', icon: Network, Route: AuthDashboardProjectsProjectIdServicesServiceIdConfigurationNetwork },
  { key: 'preview', name: 'Previews', icon: Rocket, Route: AuthDashboardProjectsProjectIdServicesServiceIdConfigurationPreview },
] as const

type ConfigSection = (typeof sectionRoute)[number]['key']

interface ServiceConfigSubNavProps {
  projectId: string
  serviceId: string
  active: ConfigSection
}

export function ServiceConfigSubNav({ projectId, serviceId, active }: ServiceConfigSubNavProps) {
  return (
    <nav className="flex items-center gap-1 overflow-x-auto rounded-xl border border-border/60 bg-card/30 p-1.5">
      {sectionRoute.map(({ key, name, icon: Icon, Route }) => {
        const isActive = active === key
        return (
          <Route.Link
            key={key}
            projectId={projectId}
            serviceId={serviceId}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" />
            {name}
          </Route.Link>
        )
      })}
    </nav>
  )
}