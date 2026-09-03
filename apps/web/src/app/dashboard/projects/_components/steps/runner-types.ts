'use client'

import type { RunnerFormData } from '../CreateService.hook'
import type { RunnerDetectionHints } from './runner-detection-context'

export type { RunnerFormData, RunnerDetectionHints }

/** Concrete (all-required) sub-service shape — defaults filled at parse. */
export interface OrchestratorSubService {
  name: string
  image: string
  build?: { context?: string; dockerfile?: string; args: Record<string, string> }
  command?: string
  entrypoint?: string
  port?: number
  ports: number[]
  portMappings: { containerPort: number; hostPort?: number; protocol: 'tcp' | 'udp'; name?: string }[]
  expose: boolean
  tls: { enabled: boolean; certSecretRef?: string; httpRedirect: boolean }
  networks: string[]
  customDomains: string[]
  environment: Record<string, string>
  volumes: string[]
  labels: Record<string, string>
  secrets: string[]
  dependsOn: string[]
  dependsOnCondition: 'service_started' | 'service_healthy' | 'service_completed_successfully'
  replicas: number
  healthCheck?: { test: string[]; interval?: number; timeout?: number; retries?: number; startPeriod?: number }
  resources?: { cpus?: number; memory?: string }
  restart: 'no' | 'always' | 'on-failure' | 'unless-stopped'
}
