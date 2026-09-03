import { domainEndpoints } from './endpoints'
import type { InvalidationConfig } from '../shared/helpers'

type DomainEndpoints = typeof domainEndpoints

function resolveId(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const c = input as Record<string, unknown>
  return (c.projectId ?? c.id ?? c.serviceId) as string | undefined
}

export const domainInvalidations: InvalidationConfig<DomainEndpoints> = {
  // ── Project domains ────────────────────────────────────────────
  listProjectDomains: ({ input, keys }) => {
    const projectId = resolveId(input)
    if (!projectId) return []
    return [keys.listProjectDomains({ input: { params: { projectId } } })]
  },
  addProjectDomain: ({ input, keys }) => {
    const projectId = resolveId(input)
    if (!projectId) return []
    return [keys.listProjectDomains({ input: { params: { projectId } } })]
  },
  updateProjectDomain: ({ input, keys }) => {
    const projectId = resolveId(input)
    if (!projectId) return []
    return [keys.listProjectDomains({ input: { params: { projectId } } })]
  },
  removeProjectDomain: ({ input, keys }) => {
    const projectId = resolveId(input)
    if (!projectId) return []
    return [keys.listProjectDomains({ input: { params: { projectId } } })]
  },
  verifyProjectDomain: ({ input, keys }) => {
    const projectId = resolveId(input)
    if (!projectId) return []
    return [keys.listProjectDomains({ input: { params: { projectId } } })]
  },
  getAvailableDomains: ({ input, keys }) => {
    const projectId = resolveId(input)
    if (!projectId) return []
    return [keys.getAvailableDomains({ input: { params: { projectId } } })]
  },
  listServiceDomains: ({ input, keys }) => {
    const serviceId = resolveId(input)
    if (!serviceId) return []
    return [keys.listServiceDomains({ input: { params: { serviceId } } })]
  },
  addServiceDomain: ({ input, keys }) => {
    const serviceId = resolveId(input)
    if (!serviceId) return []
    return [keys.listServiceDomains({ input: { params: { serviceId } } })]
  },
  removeServiceDomain: ({ input, keys }) => {
    const serviceId = resolveId(input)
    if (!serviceId) return []
    return [keys.listServiceDomains({ input: { params: { serviceId } } })]
  },
}
