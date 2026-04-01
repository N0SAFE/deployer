import { MOCK_ORGANIZATIONS } from '../entities/organizations.mock'
import { MOCK_PROJECTS } from '../entities/projects.mock'
import { MOCK_TEAMS } from '../entities/teams.mock'
import { getDependencyGraphMockScenario } from './dependency-graph.mock'
import type { PlatformMockOverview } from '../types'

export function getPlatformMockOverview(): PlatformMockOverview {
  const projectScenarios = Object.fromEntries(
    MOCK_PROJECTS.map((project) => [project.id, getDependencyGraphMockScenario(project.id)]),
  )

  return {
    organizations: MOCK_ORGANIZATIONS.map((organization) => ({ ...organization })),
    teams: MOCK_TEAMS.map((team) => ({ ...team })),
    projects: MOCK_PROJECTS.map((project) => ({ ...project })),
    projectScenarios,
  }
}
