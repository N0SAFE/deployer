import { z } from 'zod'

export const organizationPlanSchema = z.enum(['enterprise', 'team', 'free'])
export type OrganizationPlan = z.infer<typeof organizationPlanSchema>

export const serviceProviderTypeSchema = z.enum([
  'github',
  'gitlab',
  'bitbucket',
  'container-registry',
  'artifact-bundle',
  'manual',
])
export type ServiceProviderType = z.infer<typeof serviceProviderTypeSchema>
export const SERVICE_PROVIDER_TYPES = [...serviceProviderTypeSchema.options] as readonly ServiceProviderType[]

export const serviceRunnerTypeSchema = z.enum([
  'docker-compose',
  'docker-swarm',
  'kubernetes',
  'nomad',
  'static',
  'worker-runtime',
])
export type ServiceRunnerType = z.infer<typeof serviceRunnerTypeSchema>
export const SERVICE_RUNNER_TYPES = [...serviceRunnerTypeSchema.options] as readonly ServiceRunnerType[]

export const serviceRunnerStrategySchema = z.enum(['rolling', 'recreate', 'blue-green', 'canary'])
export type ServiceRunnerStrategy = z.infer<typeof serviceRunnerStrategySchema>

export const runnerNetworkModeSchema = z.enum(['bridge', 'host', 'overlay'])
export type RunnerNetworkMode = z.infer<typeof runnerNetworkModeSchema>

export const serviceDeploymentProfileSchema = z.enum(['standard', 'isolated-group', 'high-availability'])
export type ServiceDeploymentProfile = z.infer<typeof serviceDeploymentProfileSchema>
