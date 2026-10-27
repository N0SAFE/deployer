import type { RunnerDetectionHints, RunnerFormData } from '../runner-types'
import { RUNNER_DEFAULT_CONFIG, subServicesFromHints } from '../runner-presets'
import { emptySubService } from './sub-service-defaults'

type RunnerId = RunnerFormData['runnerId']

interface DeclaredService { name: string; image?: string; ports?: string[] }
interface SubServiceRef { name: string; image: string; ports?: number[] }

/**
 * Config for the new runner when the operator switches runner type.
 *
 * Switching between "Compose stack" and "Sub-services" carries the compose file,
 * profiles, environment and services across; every other switch starts from the
 * runner's defaults. Re-selecting the current runner returns `null` (keep as is).
 */
export function configForRunnerSwitch(
  currentRunnerId: RunnerId,
  currentConfig: Record<string, unknown> | undefined,
  next: RunnerId,
  detectedServices: NonNullable<RunnerDetectionHints['composeServices']>,
): RunnerFormData['config'] | null {
  if (currentRunnerId === next) return null
  const cfg = currentConfig ?? {}

  if (currentRunnerId === 'compose' && next === 'orchestrator') {
    const declared = (cfg.declaredServices as DeclaredService[] | undefined) ?? []
    return {
      ...(RUNNER_DEFAULT_CONFIG.orchestrator as Record<string, unknown>),
      composeFile: cfg.composeFile ?? 'docker-compose.yml',
      profiles: cfg.profiles ?? [],
      environment: cfg.environment ?? {},
      subServices: detectedServices.length > 0
        ? subServicesFromHints(detectedServices)
        : declared.map((d, i) => ({ ...emptySubService(i), name: d.name, image: d.image ?? '', ports: (d.ports ?? []).map(Number) })),
    } as RunnerFormData['config']
  }

  if (currentRunnerId === 'orchestrator' && next === 'compose') {
    const subs = (cfg.subServices as SubServiceRef[] | undefined) ?? []
    return {
      ...(RUNNER_DEFAULT_CONFIG.compose as Record<string, unknown>),
      appName: cfg.composeProjectName ?? '',
      composeFile: cfg.composeFile ?? 'docker-compose.yml',
      profiles: cfg.profiles ?? [],
      environment: cfg.environment ?? {},
      declaredServices: subs.map((s) => ({ name: s.name, image: s.image, ports: (s.ports ?? []).map(String) })),
    } as RunnerFormData['config']
  }

  return RUNNER_DEFAULT_CONFIG[next]
}
