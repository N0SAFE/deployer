import { latestBy, toTime } from './workload'

export interface ProjectLite { id: string; name: string; description: string | null; createdAt: string; updatedAt: string }
export interface ServiceLite { id: string; projectId: string; parentId?: string | null }
export interface DeploymentLite { id: string; serviceId: string; status: string; createdAt: string | Date }

export interface ProjectGlance {
  servicesCount: number
  lastDeployment: DeploymentLite | null
}

/** Services count + last deployment per project, derived from the two lists the page already has. */
export function buildProjectGlance(
  projects: readonly ProjectLite[],
  services: readonly ServiceLite[],
  deployments: readonly DeploymentLite[],
): Map<string, ProjectGlance> {
  const projectOfService = new Map(services.map((s) => [s.id, s.projectId]))
  const latestByProject = latestBy(deployments, (d) => projectOfService.get(d.serviceId))
  const counts = new Map<string, number>()
  for (const s of services) {
    if (s.parentId != null) continue
    counts.set(s.projectId, (counts.get(s.projectId) ?? 0) + 1)
  }
  return new Map(
    projects.map((p) => [p.id, { servicesCount: counts.get(p.id) ?? 0, lastDeployment: latestByProject.get(p.id) ?? null }]),
  )
}

export type ProjectSortKey = 'updated' | 'name' | 'created' | 'lastDeploy'

export function sortProjects(
  projects: readonly ProjectLite[],
  key: ProjectSortKey,
  glance: ReadonlyMap<string, ProjectGlance>,
): ProjectLite[] {
  const copy = [...projects]
  copy.sort((a, b) => {
    if (key === 'name') return a.name.localeCompare(b.name)
    if (key === 'created') return (toTime(b.createdAt) ?? 0) - (toTime(a.createdAt) ?? 0)
    if (key === 'lastDeploy') {
      return (toTime(glance.get(b.id)?.lastDeployment?.createdAt) ?? 0) - (toTime(glance.get(a.id)?.lastDeployment?.createdAt) ?? 0)
    }
    return (toTime(b.updatedAt) ?? 0) - (toTime(a.updatedAt) ?? 0)
  })
  return copy
}

export function matchesProjectQuery(project: ProjectLite, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return project.name.toLowerCase().includes(q) || project.id.toLowerCase().includes(q) || (project.description ?? '').toLowerCase().includes(q)
}
