import { describe, expect, it } from 'vitest'
import { buildProjectGlance, matchesProjectQuery, sortProjects } from '../project-overview'

const p = (id: string, name: string, updatedAt = '2026-10-01T00:00:00Z') => ({ id, name, description: null, createdAt: '2026-09-01T00:00:00Z', updatedAt })

describe('project overview helpers', () => {
  const beta = p('p1', 'beta')
  const projects = [beta, p('p2', 'alpha', '2026-10-05T00:00:00Z')]
  const services = [
    { id: 's1', projectId: 'p1' },
    { id: 's2', projectId: 'p1', parentId: 's1' },
    { id: 's3', projectId: 'p2' },
  ]
  const deployments = [
    { id: 'd1', serviceId: 's1', status: 'failed', createdAt: '2026-10-02T00:00:00Z' },
    { id: 'd2', serviceId: 's2', status: 'success', createdAt: '2026-10-03T00:00:00Z' },
  ]

  it('counts only top-level services and finds the latest deployment across all services', () => {
    const g = buildProjectGlance(projects, services, deployments)
    expect(g.get('p1')?.servicesCount).toBe(1)
    expect(g.get('p1')?.lastDeployment?.id).toBe('d2')
    expect(g.get('p2')?.lastDeployment).toBeNull()
  })

  it('sorts', () => {
    const g = buildProjectGlance(projects, services, deployments)
    expect(sortProjects(projects, 'name', g)[0]?.name).toBe('alpha')
    expect(sortProjects(projects, 'updated', g)[0]?.id).toBe('p2')
    expect(sortProjects(projects, 'lastDeploy', g)[0]?.id).toBe('p1')
  })

  it('matches name, id and description', () => {
    expect(matchesProjectQuery(beta, 'BET')).toBe(true)
    expect(matchesProjectQuery(beta, 'p1')).toBe(true)
    expect(matchesProjectQuery(beta, 'zzz')).toBe(false)
  })
})
