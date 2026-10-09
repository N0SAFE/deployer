export interface LogLineProjection {
  id: string
  containerId: string | null
  containerName: string
  source: 'runtime' | 'container'
  status: string
  /** stdout/stderr for container output; absent for runtime events. */
  stream?: string
  message: string
  timestamp: string
}

export const CONTAINER_STREAM_LOG_LIMIT = 1_500
export const RUNTIME_EVENT_LOG_LIMIT = 240
