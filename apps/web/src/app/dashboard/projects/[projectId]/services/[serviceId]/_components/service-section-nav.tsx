'use client'

import {
  AuthDashboardProjectsProjectIdServicesServiceId,
  AuthDashboardProjectsProjectIdServicesServiceIdConfiguration,
  AuthDashboardProjectsProjectIdServicesServiceIdDeployments,
  AuthDashboardProjectsProjectIdServicesServiceIdLogs,
  AuthDashboardProjectsProjectIdServicesServiceIdMonitoring,
  AuthDashboardProjectsProjectIdServicesServiceIdPreviews,
} from '@/routes'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Settings2,
  Layers3,
  ScrollText,
  GitBranch,
  Activity,
  type LucideIcon,
} from 'lucide-react'

type ServiceSection = 'overview' | 'configuration' | 'deployments' | 'logs' | 'previews' | 'monitoring'

interface ServiceSectionNavProps {
  projectId: string
  serviceId: string
  active: ServiceSection
}

const sections: Array<{ key: ServiceSection; label: string; icon: LucideIcon }> = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'configuration', label: 'Configuration', icon: Settings2 },
  { key: 'deployments', label: 'Deployments', icon: Layers3 },
  { key: 'logs', label: 'Logs', icon: ScrollText },
  { key: 'previews', label: 'Previews', icon: GitBranch },
  { key: 'monitoring', label: 'Monitoring', icon: Activity },
]

const sectionRoute = {
  overview: AuthDashboardProjectsProjectIdServicesServiceId,
  configuration: AuthDashboardProjectsProjectIdServicesServiceIdConfiguration,
  deployments: AuthDashboardProjectsProjectIdServicesServiceIdDeployments,
  logs: AuthDashboardProjectsProjectIdServicesServiceIdLogs,
  previews: AuthDashboardProjectsProjectIdServicesServiceIdPreviews,
  monitoring: AuthDashboardProjectsProjectIdServicesServiceIdMonitoring,
} as const

export function ServiceSectionNav({ projectId, serviceId, active }: ServiceSectionNavProps) {
  return (
    <nav className="flex items-center gap-1 overflow-x-auto rounded-xl border border-border/60 bg-card/30 p-1.5">
      {sections.map(({ key, label, icon: Icon }) => {
        const Route = sectionRoute[key]
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
            {label}
          </Route.Link>
        )
      })}
    </nav>
  )
}