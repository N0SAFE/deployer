'use client'

import { Tabs, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
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

type ProjectSection = 'overview' | 'services' | 'environments' | 'configuration' | 'dependencies' | 'deployments' | 'team' | 'domains'

interface ProjectSectionNavProps {
  projectId: string
  active: ProjectSection
}

const sectionLabel: Record<ProjectSection, string> = {
  overview: 'Overview',
  services: 'Services',
  environments: 'Environments',
  configuration: 'Settings',
  dependencies: 'Dependencies',
  deployments: 'Deployments',
  team: 'Team',
  domains: 'Domains',
}

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

const sections: ProjectSection[] = [
  'overview',
  'services',
  'environments',
  'deployments',
  'dependencies',
  'domains',
  'team',
  'configuration',
]

/**
 * Project section navigation tabs.
 * Follows the same pattern as ServiceSectionNav in services/[serviceId]/_components/.
 * Each tab navigates to its own route via typed <Route.Link>.
 */
export function ProjectSectionNav({ projectId, active }: ProjectSectionNavProps) {
  return (
    <Tabs value={active} className="rounded-xl border border-border/60 bg-card/30 p-2">
      <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
        {sections.map((section) => {
          const Route = sectionRoute[section]
          return (
            <TabsTrigger key={section} value={section} asChild className="h-8">
              <Route.Link projectId={projectId}>
                {sectionLabel[section]}
              </Route.Link>
            </TabsTrigger>
          )
        })}
      </TabsList>
    </Tabs>
  )
}
