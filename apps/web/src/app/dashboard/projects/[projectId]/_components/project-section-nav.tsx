'use client'

import {
  LayoutDashboard, Boxes, Layers3, Rocket, Network, Globe, Users, Settings2, type LucideIcon,
} from 'lucide-react'
import {
  AuthDashboardProjectsProjectId,
  AuthDashboardProjectsProjectIdServices,
  AuthDashboardProjectsProjectIdEnvironments,
  AuthDashboardProjectsProjectIdConfiguration,
  AuthDashboardProjectsProjectIdDependencies,
  AuthDashboardProjectsProjectIdDeployments,
  AuthDashboardProjectsProjectIdTeam,
  AuthDashboardProjectsProjectIdDomains,
} from '@/routes'
import { ScopedSectionNav, type ScopedNavItem } from '../../_components/workload/ScopedSectionNav'

type ProjectSection = 'overview' | 'services' | 'environments' | 'configuration' | 'dependencies' | 'deployments' | 'team' | 'domains'

interface ProjectSectionNavProps {
  projectId: string
  active: ProjectSection
}

const sections: readonly { key: ProjectSection; title: string; icon: LucideIcon }[] = [
  { key: 'overview', title: 'Overview', icon: LayoutDashboard },
  { key: 'services', title: 'Services', icon: Boxes },
  { key: 'environments', title: 'Environments', icon: Layers3 },
  { key: 'deployments', title: 'Deployments', icon: Rocket },
  { key: 'dependencies', title: 'Dependencies', icon: Network },
  { key: 'domains', title: 'Domains', icon: Globe },
  { key: 'team', title: 'Team', icon: Users },
  { key: 'configuration', title: 'Settings', icon: Settings2 },
]

const sectionRoute = {
  overview: AuthDashboardProjectsProjectId,
  services: AuthDashboardProjectsProjectIdServices,
  environments: AuthDashboardProjectsProjectIdEnvironments,
  configuration: AuthDashboardProjectsProjectIdConfiguration,
  dependencies: AuthDashboardProjectsProjectIdDependencies,
  deployments: AuthDashboardProjectsProjectIdDeployments,
  team: AuthDashboardProjectsProjectIdTeam,
  domains: AuthDashboardProjectsProjectIdDomains,
} as const

/** Project section tabs: same tab strip as every other section, scrolls horizontally at 375 px. */
export function ProjectSectionNav({ projectId, active }: ProjectSectionNavProps) {
  const items: ScopedNavItem[] = sections.map(({ key, title, icon }) => {
    const Route = sectionRoute[key]
    return {
      key,
      title,
      icon,
      active: active === key,
      renderLink: ({ className, children, 'aria-current': ariaCurrent }) => (
        <Route.Link projectId={projectId} className={className} aria-current={ariaCurrent}>{children}</Route.Link>
      ),
    }
  })
  return <ScopedSectionNav label="Project sections" items={items} />
}
