import z from 'zod'

export const serviceProviderTypeSchema = z.enum([
  'github',
  'gitlab',
  'bitbucket',
  'container-registry',
  'artifact-bundle',
  'manual',
])
export type ServiceProviderType = z.infer<typeof serviceProviderTypeSchema>
export const SERVICE_PROVIDER_TYPES = Object.freeze([...serviceProviderTypeSchema.options])

/**
 * SERVICE TYPE — the kind of deployable unit. Dokploy-style: each type has
 * its own config shape + deploy semantics.
 *
 *  - `application`:   a single container (built from source or prebuilt image).
 *  - `compose`:       ONE docker-compose stack managed as a single unit —
 *                     `docker compose up/down/logs` on the whole stack; the
 *                     service behaves as one service even though the compose
 *                     file may declare many services. Individual services can
 *                     still be updated (image/env) via the compose file, but
 *                     there is no per-service lifecycle control.
 *  - `sub-services`:  an ORCHESTRATOR — each service inside the manifest is a
 *                     first-class, individually-managed unit with its own
 *                     lifecycle, networking, and a dependency graph. Selected
 *                     explicitly OR prompted when auto-detection finds a
 *                     compose file with multiple services.
 *  - `database`:      a managed database (postgres / mysql / redis / …).
 *  - `static`:        static files (SPA / JAMstack output).
 *  - `worker`:        a queue worker (N concurrent consumers).
 *  - `kubernetes`:    a Kubernetes manifest / workload (Deployment).
 *  - `nomad`:         a Nomad job on the cluster.
 */
export const serviceTypeSchema = z.enum([
  'application',
  'compose',
  'sub-services',
  'database',
  'static',
  'worker',
  'kubernetes',
  'nomad',
])
export type ServiceType = z.infer<typeof serviceTypeSchema>
export const SERVICE_TYPES = Object.freeze([...serviceTypeSchema.options])

export const serviceRunnerTypeSchema = z.enum([
  'manual',
  'compose',
  'orchestrator',
  'kubernetes',
  'nomad',
  'static',
  'worker-runtime',
  'mock',
])
export type ServiceRunnerType = z.infer<typeof serviceRunnerTypeSchema>
export const SERVICE_RUNNER_TYPES = Object.freeze([...serviceRunnerTypeSchema.options])

export const serviceRunnerStrategySchema = z.enum(['rolling', 'recreate', 'blue-green', 'canary'])
export type ServiceRunnerStrategy = z.infer<typeof serviceRunnerStrategySchema>

export const runnerNetworkModeSchema = z.enum(['bridge', 'host', 'overlay'])
export type RunnerNetworkMode = z.infer<typeof runnerNetworkModeSchema>

/**
 * PER-ENVIRONMENT DEPLOYMENT STRATEGY.
 * Every environment (production / staging / preview / development) may carry
 * its own rollout strategy. When deploying to an environment, the strategy
 * for THAT environment is followed (falling back to the service default).
 */
export const perEnvironmentStrategySchema = z
  .object({
    production: serviceRunnerStrategySchema.optional(),
    staging: serviceRunnerStrategySchema.optional(),
    preview: serviceRunnerStrategySchema.optional(),
    development: serviceRunnerStrategySchema.optional(),
  })
  .catchall(serviceRunnerStrategySchema)
export type PerEnvironmentStrategy = z.infer<typeof perEnvironmentStrategySchema>

export const serviceDeploymentProfileSchema = z.enum(['standard', 'isolated-group', 'high-availability'])
export type ServiceDeploymentProfile = z.infer<typeof serviceDeploymentProfileSchema>

export const dnsProviderTypeSchema = z.enum([
  'cloudflare',
  'route53',
  'google-dns',
  'digitalocean',
  'other',
])
export type DnsProviderType = z.infer<typeof dnsProviderTypeSchema>
export const DNS_PROVIDER_TYPES = Object.freeze([...dnsProviderTypeSchema.options])

export const dnsRecordTypeSchema = z.enum([
  'A',
  'AAAA',
  'CNAME',
  'TXT',
  'MX',
  'NS',
  'SRV',
  'CAA',
])
export type DnsRecordType = z.infer<typeof dnsRecordTypeSchema>
export const DNS_RECORD_TYPES = Object.freeze([...dnsRecordTypeSchema.options])
