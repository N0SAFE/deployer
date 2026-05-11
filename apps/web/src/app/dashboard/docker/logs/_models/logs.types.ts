export interface LogLineProjection {
  id: string
  containerId: string | null
  containerName: string
  source: 'runtime' | 'container'
  status: string
  message: string
  timestamp: string
}

export interface ContainerLogGroup {
  id: string
  name: string
  containers: string[]
}

export interface ServiceEnvironmentNode {
  environment: string
  containers: string[]
}

export interface ServiceEnvironmentGroup {
  serviceId: string
  serviceName: string
  environments: ServiceEnvironmentNode[]
  containers: string[]
}

export const LOG_GROUPS_STORAGE_KEY = 'docker:logs:container-groups'
export const CONTAINER_STREAM_LOG_LIMIT = 1_500
export const RUNTIME_EVENT_LOG_LIMIT = 240
