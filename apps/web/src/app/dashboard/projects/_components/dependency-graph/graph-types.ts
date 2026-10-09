export interface ServiceGraphNode {
  id: string
  name: string
  type: string
  projectId: string
  isActive: boolean
  /** Non-null when this service is a sub-service of another (hierarchy). */
  parentId?: string | null
  status?: string
}

export interface DependencyRecord {
  id: string
  serviceId: string
  dependsOnServiceId: string
  isRequired: boolean
  enabledIn?: string[]
}

export interface ServiceGraphDependency {
  id: string
  serviceId: string
  dependsOnServiceId: string
  isRequired?: boolean
  enabledIn?: string[]
}

export interface ServiceGraphDependencyRoute {
  dependencyId: string
  sourceScope: string
  targetScope: string
}

export interface ServiceNodeData extends Record<string, unknown> {
  service: ServiceGraphNode
  dependencies: number
  dependents: number
  environment: string
  onNavigate?: (serviceId: string) => void
}

export interface EnvironmentGroupNodeData extends Record<string, unknown> {
  environment: string
  serviceCount: number
  linkCount: number
}

export interface SubserviceGroupNodeData extends Record<string, unknown> {
  service: ServiceGraphNode
  childCount: number
  environment: string
}
