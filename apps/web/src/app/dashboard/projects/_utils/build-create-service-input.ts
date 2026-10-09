import type { ServiceCreateInput, ServiceCreateInputInput } from '@repo/api-contracts/modules/service/crud/create'
import type { RouteVisibility } from '@repo/api-contracts/modules/reachability/index'
import { orchestratorRunnerConfigSchema } from '@repo/contracts-entities'

/**
 * Maps the create-service wizard's output to the `service.create` input.
 * Moved verbatim out of the Services page so the page stays a view; the payload
 * is unchanged.
 */
export interface CreateWizardPayload {
  basicInfo?: { name?: string; type?: string }
  provider?: {
    providerId?: string
    config?: Record<string, unknown>
  }
  runner?: {
    runnerId?: string
    build?: Record<string, unknown>
    config?: Record<string, unknown>
  }
  network?: {
    port?: number
    visibility?: RouteVisibility
    tls?: { enabled?: boolean; certSecretRef?: string; httpRedirect?: boolean }
    healthCheck?: { type?: string; path?: string; interval?: number; timeout?: number; retries?: number }
    domainEntries?: Array<{
      projectDomainId: string
      subdomain: string | null
      basePath: string | null
      isPrimary: boolean
      sslEnabled: boolean
    }>
  }
}

export function buildCreateServiceInput(data: CreateWizardPayload, projectId: string) {
  const runnerId = (data.runner?.runnerId ?? 'manual') as "manual" | "compose" | "orchestrator" | "kubernetes" | "nomad" | "static" | "worker-runtime"
  const rc = data.runner?.config ?? {}
  const build = data.runner?.build ?? {}

  const providerConfigBase = {
    ...(data.provider?.config ?? {}),
    rootPath: build.rootPath ?? '/',
    buildContext: build.buildContext ?? '.',
    dockerfilePath: build.dockerfilePath,
  }

  const shared = {
    strategy: rc.strategy ?? 'rolling',
    networkMode: rc.networkMode ?? 'bridge',
    gracefulShutdownSeconds: rc.gracefulShutdownSeconds ?? 30,
  }
  const execution = {
    ...shared,
    startCommand: rc.startCommand ?? '',
    args: rc.args ?? [],
    ports: rc.ports ?? [],
    volumeMounts: rc.volumeMounts ?? [],
    secretRefs: rc.secretRefs ?? [],
  }
  const perRunnerFields: Record<string, Record<string, unknown>> = {
    manual: execution,
    compose: {
      ...shared,
      appName: rc.appName ?? 'stack',
      composeFile: rc.composeFile ?? 'docker-compose.yml',
      profiles: rc.profiles ?? [],
      environment: rc.environment ?? {},
      declaredServices: rc.declaredServices ?? [],
    },
    orchestrator: {
      ...shared,
      composeFile: rc.composeFile ?? 'docker-compose.yml',
      composeProjectName: rc.composeProjectName,
      profiles: rc.profiles ?? [],
      subServices: rc.subServices ?? [],
      environment: rc.environment ?? {},
    },
    kubernetes: {
      ...execution,
      namespace: rc.namespace ?? 'default',
      deploymentName: rc.deploymentName,
      replicas: rc.replicas ?? 1,
      serviceAccountName: rc.serviceAccountName,
    },
    nomad: {
      ...execution,
      jobName: rc.jobName,
      datacenter: rc.datacenter ?? 'dc1',
      nomadNamespace: rc.nomadNamespace,
    },
    'worker-runtime': {
      ...execution,
      queueName: rc.queueName,
      concurrency: rc.concurrency ?? 1,
      maxRetries: rc.maxRetries ?? 0,
    },
    static: {
      strategy: 'recreate',
      startCommand: rc.startCommand ?? '',
      args: rc.args ?? [],
      ports: rc.ports ?? [],
      volumeMounts: rc.volumeMounts ?? [],
      secretRefs: rc.secretRefs ?? [],
      networkMode: rc.networkMode ?? 'bridge',
      gracefulShutdownSeconds: rc.gracefulShutdownSeconds ?? 30,
      outputDir: rc.outputDir ?? 'dist',
      indexFile: rc.indexFile ?? 'index.html',
      errorPage: rc.errorPage,
    },
  }
  const builderConfig = perRunnerFields[runnerId] ?? execution
  const net = data.network ?? {}
  const hc = net.healthCheck ?? { type: 'none' }
  const healthCheckPath = hc.type === 'http' ? (hc as { path?: string }).path ?? '/health' : null
  const healthCheckInterval = hc.type === 'none' ? null : (hc as { interval?: number }).interval ?? 30
  const healthCheckTimeout = hc.type === 'none' ? null : (hc as { timeout?: number }).timeout ?? 10
  const healthCheckRetries = hc.type === 'none' ? null : (hc as { retries?: number }).retries ?? 3

  const parsedOrchestrator = orchestratorRunnerConfigSchema.safeParse(rc)
  const orchestrator = parsedOrchestrator.success ? parsedOrchestrator.data : undefined

  const mapSubService = (
    svc: {
      name: string
      image?: string
      port?: number
      environment?: Record<string, string>
      replicas?: number
      dependsOn?: string[]
      customDomains?: string[]
      visibility?: RouteVisibility
      tls?: { enabled?: boolean; httpRedirect?: boolean }
      healthCheck?: unknown
      resources?: { cpus?: number; memory?: string }
    },
    serviceName: string,
  ): ServiceCreateInputInput => {
    const env = svc.environment ?? {}
    const mergedEnv = { ...(orchestrator?.environment ?? {}), ...env }
    const parentProviderConfig = (data.provider?.config ?? {}) as Record<string, unknown>
    const parentSourceUrl = typeof parentProviderConfig.sourceUrl === 'string' && parentProviderConfig.sourceUrl
      ? parentProviderConfig.sourceUrl
      : 'https://github.com/N0SAFE/deployer'
    const parentBranch = typeof parentProviderConfig.branch === 'string' && parentProviderConfig.branch
      ? parentProviderConfig.branch
      : 'main'
    const childProviderId = (data.provider?.providerId ?? 'github') as 'github' | 'gitlab' | 'bitbucket' | 'container-registry' | 'artifact-bundle' | 'manual'
    const childImage = svc.image && svc.image.length > 0 ? svc.image : undefined
    const containerImage = childImage ?? 'scratch'
    return {
      projectId,
      name: svc.name || serviceName,
      type: 'application',
      providerId: childProviderId,
      providerConfig: childProviderId === 'container-registry' || childProviderId === 'artifact-bundle'
        ? {
            sourceUrl: parentSourceUrl,
            branch: parentBranch,
            rootPath: '/',
            buildContext: '.',
            image: containerImage,
            autoSyncEnabled: false,
            webhookEnabled: false,
            authSecretRef: 'default',
          }
        : {
            sourceUrl: parentSourceUrl,
            branch: parentBranch,
            rootPath: '/',
            buildContext: '.',
            image: childImage,
            autoSyncEnabled: false,
            webhookEnabled: false,
            authSecretRef: 'default',
          },
      builderId: 'orchestrator',
      builderConfig: orchestrator ?? {
        strategy: 'rolling' as const,
        networkMode: 'bridge' as const,
        gracefulShutdownSeconds: 30,
        composeFile: 'docker-compose.yml',
        profiles: [],
        subServices: [],
        environment: mergedEnv,
        autoDeploySubtree: 'whole-stack',
        previewScope: 'whole-stack',
      },
      port: svc.port ?? null,
      environmentVariables: Object.keys(mergedEnv).length > 0 ? mergedEnv : null,
      customDomains: svc.customDomains?.length ? svc.customDomains : undefined,
      network: {
        visibility: svc.visibility ?? 'public',
        tls: { enabled: svc.tls?.enabled ?? false, httpRedirect: svc.tls?.httpRedirect ?? true },
      },
      metadata: {
        replicas: svc.replicas ?? 1,
        dependsOn: svc.dependsOn ?? [],
        resources: svc.resources ?? null,
      },
    }
  }

  const subServices = ((rc as { subServices?: unknown[] }).subServices ?? []) as Parameters<typeof mapSubService>[0][]
  const children = subServices.map((svc) => mapSubService(svc, svc.name))


  return {
      name: data.basicInfo?.name ?? '',
      type: (runnerId === 'manual' ? 'application'
        : runnerId === 'compose' ? 'compose'
        : runnerId === 'orchestrator' ? 'sub-services'
        : runnerId === 'worker-runtime' ? 'worker'
        : runnerId) as ServiceCreateInput['type'],
      providerId: (data.provider?.providerId ?? 'github') as ServiceCreateInput['providerId'],
      providerConfig: providerConfigBase as ServiceCreateInput['providerConfig'],
      builderId: runnerId,
      builderConfig: builderConfig as ServiceCreateInput['builderConfig'],
      port: net.port ?? undefined,
      healthCheckPath,
      healthCheckInterval,
      healthCheckTimeout,
      healthCheckRetries,
      network: {
        visibility: net.visibility ?? 'public',
        tls: { enabled: net.tls?.enabled ?? false, httpRedirect: net.tls?.httpRedirect ?? true },
      },
      metadata: {
        healthCheck: hc.type === 'none' ? null : {
          type: hc.type,
          ...(hc as Record<string, unknown>),
        },
      },
      ...(children.length > 0 ? { children } : {}),
      projectId,
  }
}
