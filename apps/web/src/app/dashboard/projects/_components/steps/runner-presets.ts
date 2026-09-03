'use client'

import type { ComponentType } from 'react'
import { Box, Cog, FileCode2, Globe, Layers, Package, Server, Sparkles, Container, TrainFront, ShipWheel, FlaskConical, type LucideIcon } from 'lucide-react'
import type { RunnerFormData, RunnerDetectionHints, OrchestratorSubService } from './runner-types'

/* ─── Runner type metadata ─────────────────────────────────────────── */

export interface RunnerMeta {
  value: RunnerFormData['runnerId']
  label: string
  description: string
  icon: LucideIcon
}

export const RUNNER_META: RunnerMeta[] = [
  { value: 'manual', label: 'Manual container', description: 'Run a single container with an explicit start command.', icon: Container },
  { value: 'compose', label: 'Compose stack', description: 'One service managing a docker-compose stack as a single unit (up/down/logs on the whole stack).', icon: ShipWheel },
  { value: 'orchestrator', label: 'Sub-services', description: 'Orchestrator — every service inside the manifest is individually managed with a dependency graph.', icon: Layers },
  { value: 'kubernetes', label: 'Kubernetes', description: 'Deploy as a Kubernetes workload (Deployment).', icon: Box },
  { value: 'nomad', label: 'Nomad', description: 'Schedule a Nomad job on the cluster.', icon: Server },
  { value: 'worker-runtime', label: 'Worker Runtime', description: 'Consume a queue with N concurrent workers.', icon: Cog },
  { value: 'static', label: 'Static', description: 'Serve static files (SPA / JAMstack output).', icon: Globe },
  { value: 'mock', label: 'Mock API', description: 'Replacement implementation of a contract (Prism/WireMock/json-server) — for previews.', icon: FlaskConical },
]

export const RUNNER_META_BY_ID = Object.fromEntries(RUNNER_META.map((r) => [r.value, r])) as Record<RunnerFormData['runnerId'], RunnerMeta>

/* ─── Build method metadata ────────────────────────────────────────── */

export type BuildMethod = 'auto' | 'dockerfile' | 'nixpacks' | 'buildpack' | 'railpack' | 'external'

export interface BuildMethodMeta {
  value: BuildMethod
  label: string
  description: string
  icon: ComponentType<{ className?: string }>
}

export const BUILD_METHOD_META: BuildMethodMeta[] = [
  { value: 'auto', label: 'Auto-detect', description: 'Detect the best build method from your code.', icon: Sparkles },
  { value: 'dockerfile', label: 'Dockerfile', description: 'Build with the Dockerfile in your repository.', icon: FileCode2 },
  { value: 'nixpacks', label: 'Nixpacks', description: 'Zero-config containerization for your stack.', icon: Package },
  { value: 'buildpack', label: 'Buildpack', description: 'Cloud Native Buildpacks (Heroku-style).', icon: Layers },
  { value: 'railpack', label: 'Railpack', description: 'Railpack runtime detection & builds.', icon: TrainFront },
  { value: 'external', label: 'Prebuilt image', description: 'Use an existing container image — no build.', icon: Container },
]

export const BUILD_METHOD_META_BY_ID = Object.fromEntries(BUILD_METHOD_META.map((m) => [m.value, m])) as Record<BuildMethod, BuildMethodMeta>

/* ─── Per-runner default configs ───────────────────────────────────── */

export const RUNNER_DEFAULT_CONFIG: Record<RunnerFormData['runnerId'], RunnerFormData['config']> = {
  manual: {
    strategy: 'rolling',
    startCommand: 'npm start',
    args: [],
    ports: [],
    volumeMounts: [],
    secretRefs: [],
    networkMode: 'bridge',
    gracefulShutdownSeconds: 30,
  },
  orchestrator: {
    strategy: 'rolling',
    networkMode: 'bridge',
    gracefulShutdownSeconds: 30,
    composeFile: 'docker-compose.yml',
    composeProjectName: '',
    profiles: [],
    subServices: [],
    environment: {},
    autoDeploySubtree: 'whole-stack',
    previewScope: 'whole-stack',
  },
  compose: {
    strategy: 'rolling',
    networkMode: 'bridge',
    gracefulShutdownSeconds: 30,
    appName: '',
    composeFile: 'docker-compose.yml',
    profiles: [],
    environment: {},
    declaredServices: [],
  },
  kubernetes: {
    strategy: 'rolling',
    startCommand: '',
    args: [],
    ports: [],
    volumeMounts: [],
    secretRefs: [],
    networkMode: 'bridge',
    gracefulShutdownSeconds: 30,
    namespace: 'default',
    deploymentName: '',
    replicas: 1,
    serviceAccountName: '',
  },
  nomad: {
    strategy: 'rolling',
    startCommand: '',
    args: [],
    ports: [],
    volumeMounts: [],
    secretRefs: [],
    networkMode: 'bridge',
    gracefulShutdownSeconds: 30,
    jobName: '',
    datacenter: 'dc1',
    nomadNamespace: '',
  },
  'worker-runtime': {
    strategy: 'rolling',
    startCommand: '',
    args: [],
    ports: [],
    volumeMounts: [],
    secretRefs: [],
    networkMode: 'bridge',
    gracefulShutdownSeconds: 30,
    queueName: '',
    concurrency: 1,
    maxRetries: 0,
  },
  static: {
    strategy: 'recreate',
    startCommand: '',
    args: [],
    ports: [],
    volumeMounts: [],
    secretRefs: [],
    networkMode: 'bridge',
    gracefulShutdownSeconds: 30,
    outputDir: 'dist',
    indexFile: 'index.html',
    errorPage: '',
  },
  mock: {
    implements: { contractRef: '', compatibility: 'http' },
    engine: 'prism',
    source: { kind: 'openapi', specPath: 'contracts/api.oas3.yml' },
    behavior: { latencyMs: 0, failRatePercent: 0 },
    previewOnly: true,
  },
}

/* ─── Detection → runner mapping ───────────────────────────────────── */

/**
 * Convert detection hints' composeServices into concrete OrchestratorSubService
 * entries (defaults filled). Shared by runnerFromDetection (initial import)
 * and the compose-file switch re-detection in StepRunner.
 */
export function subServicesFromHints(composeServices: RunnerDetectionHints['composeServices']): OrchestratorSubService[] {
  return (composeServices ?? []).map((s) => ({
    name: s.name,
    image: s.image,
    build: s.build ? { context: s.build.context, dockerfile: s.build.dockerfile, args: s.build.args ?? {} } : { args: {} },
    command: s.command,
    entrypoint: s.entrypoint,
    ports: s.ports ?? [],
    portMappings: [],
    expose: false,
    tls: { enabled: false, httpRedirect: true },
    networks: s.networks ?? [],
    customDomains: [],
    environment: s.environment ?? {},
    volumes: s.volumes ?? [],
    labels: s.labels ?? {},
    secrets: s.secrets ?? [],
    dependsOn: s.dependsOn ?? [],
    dependsOnCondition: (s.dependsOnCondition === 'service_healthy' || s.dependsOnCondition === 'service_completed_successfully' ? s.dependsOnCondition : 'service_started'),
    replicas: s.replicas ?? 1,
    healthCheck: s.healthCheck ? { test: ['CMD-SHELL', 'exit 0'], ...s.healthCheck } : undefined,
    resources: s.resources,
    restart: (s.restart ?? 'no') as OrchestratorSubService['restart'],
  }))
}

/**
 * Build the full runner payload from a detection result.
 * Detection returns a BUILD-METHOD-ish builder id (dockerfile / nixpacks /
 * buildpack / railpack / docker-compose / static / worker-runtime). We map
 * it to a valid SERVICE RUNNER + build method:
 *  - docker-compose → orchestrator (sub-services come from detection hints)
 *  - static / worker-runtime → their runner kinds directly
 *  - dockerfile / nixpacks / buildpack / railpack → manual container with
 *    the detected start command (a single built image run explicitly)
 */
export function runnerFromDetection(detectedBuilder: string | null, hints: RunnerDetectionHints | null): RunnerFormData {
  const h = hints ?? {}
  const buildBase = {
    method: 'auto' as const,
    rootPath: h.rootPath ?? '/',
    buildContext: h.buildContext ?? '.',
    dockerfilePath: h.dockerfilePath ?? 'Dockerfile',
    composeFile: h.composeFile ?? 'docker-compose.yml',
    buildCommand: h.buildCommand ?? '',
    runCommand: '',
  }

  const buildMethod = (['dockerfile', 'nixpacks', 'buildpack', 'railpack'] as const).includes(detectedBuilder as never)
    ? detectedBuilder as 'dockerfile' | 'nixpacks' | 'buildpack' | 'railpack'
    : 'auto'

  const build = buildMethod === 'auto' ? { ...buildBase, method: 'auto' as const } : { ...buildBase, method: buildMethod }

  const execBase = {
    strategy: 'rolling' as const,
    startCommand: h.startCommand ?? 'npm start',
    args: [] as string[],
    ports: h.ports ?? [],
    volumeMounts: [] as string[],
    secretRefs: [] as string[],
    networkMode: 'bridge' as const,
    gracefulShutdownSeconds: 30,
  }

  if (detectedBuilder === 'static') {
    return {
      runnerId: 'static',
      build,
      config: {
        strategy: 'recreate' as const,
        startCommand: h.startCommand ?? '',
        args: [],
        ports: h.ports ?? [],
        volumeMounts: [],
        secretRefs: [],
        networkMode: 'bridge' as const,
        gracefulShutdownSeconds: 30,
        outputDir: h.outputDir ?? 'dist',
        indexFile: h.indexFile ?? 'index.html',
        errorPage: '',
      },
    }
  }

  if (detectedBuilder === 'worker-runtime') {
    return {
      runnerId: 'worker-runtime',
      build,
      config: { ...execBase, queueName: 'default', concurrency: 1, maxRetries: 0 },
    }
  }

  if (detectedBuilder === 'docker-compose') {
    // DEFAULT: one service managing the compose stack as a unit (docker
    // compose up/down/logs on the whole stack). Sub-services are OPT-IN via
    // the runner picker ("Sub-services") — the UI prompts to switch when the
    // compose file declares multiple services.
    return {
      runnerId: 'compose',
      build,
      config: {
        strategy: 'rolling' as const,
        networkMode: 'bridge' as const,
        gracefulShutdownSeconds: 30,
        appName: '',
        composeFile: h.composeFile ?? 'docker-compose.yml',
        profiles: [],
        environment: {},
        declaredServices: (h.composeServices ?? []).map((s) => ({
          name: s.name,
          image: s.image,
          ports: (s.ports ?? []).map(String),
        })),
      },
    }
  }

  // dockerfile / nixpacks / buildpack / railpack / null → manual container
  return {
    runnerId: 'manual',
    build,
    config: { ...execBase },
  }
}
