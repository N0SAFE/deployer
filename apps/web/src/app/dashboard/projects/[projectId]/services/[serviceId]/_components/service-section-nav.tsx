'use client'

import {
  AuthDashboardProjectsProjectIdServicesServiceId,
  AuthDashboardProjectsProjectIdServicesServiceIdConfiguration,
  AuthDashboardProjectsProjectIdServicesServiceIdDeployments,
  AuthDashboardProjectsProjectIdServicesServiceIdLogs,
  AuthDashboardProjectsProjectIdServicesServiceIdMonitoring,
  AuthDashboardProjectsProjectIdServicesServiceIdPreviews,
} from '@/routes'
import { LayoutDashboard, Settings2, Layers3, ScrollText, GitBranch, Activity, type LucideIcon } from 'lucide-react'
import { ScopedSectionNav, type ScopedNavItem } from '../../../../_components/workload/ScopedSectionNav'

type ServiceSection = 'overview' | 'configuration' | 'deployments' | 'logs' | 'previews' | 'monitoring'

interface ServiceSectionNavProps {
  projectId: string
  serviceId: string
  active: ServiceSection
}

const sections: readonly { key: ServiceSection; title: string; icon: LucideIcon }[] = [
  { key: 'overview', title: 'Overview', icon: LayoutDashboard },
  { key: 'deployments', title: 'Deployments', icon: Layers3 },
  { key: 'logs', title: 'Activity', icon: ScrollText },
  { key: 'monitoring', title: 'Monitoring', icon: Activity },
  { key: 'previews', title: 'Previews', icon: GitBranch },
  { key: 'configuration', title: 'Configuration', icon: Settings2 },
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
  const items: ScopedNavItem[] = sections.map(({ key, title, icon }) => {
    const Route = sectionRoute[key]
    return {
      key,
      title,
      icon,
      active: active === key,
      renderLink: ({ className, children, 'aria-current': ariaCurrent }) => (
        <Route.Link projectId={projectId} serviceId={serviceId} className={className} aria-current={ariaCurrent}>{children}</Route.Link>
      ),
    }
  })
  return <ScopedSectionNav label="Service sections" items={items} />
}
