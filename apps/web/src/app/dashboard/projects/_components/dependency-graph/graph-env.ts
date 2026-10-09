import { type EnvName } from '@repo/contracts-common'
import type { DependencyRecord } from './graph-types'

export const GROUP_NODE_WIDTH = 1040
export const GROUP_NODE_GAP = 120
export const GROUP_HEADER_HEIGHT = 48
export const GROUP_PADDING_X = 28
export const GROUP_PADDING_Y = 72
export const GROUP_NODE_MIN_HEIGHT = 320
export const GROUP_SERVICE_COLUMNS = 3
export const GROUP_SERVICE_HORIZONTAL_GAP = 320
export const GROUP_SERVICE_VERTICAL_GAP = 170

export const EDGE_ACTIVE_OPACITY = 0.95
export const EDGE_INACTIVE_OPACITY = 0.38
export const EDGE_DIMMED_OPACITY = 0.17

export const ENV_EDGE_COLORS: Record<EnvName, string> = {
  production: '#22c55e',
  staging: '#a855f7',
  preview: '#06b6d4',
  development: '#f59e0b',
}

export function getColorForEnvironment(environment: string): string {
  if (environment in ENV_EDGE_COLORS) {
    return ENV_EDGE_COLORS[environment as EnvName]
  }

  let hash = 0
  for (let index = 0; index < environment.length; index += 1) {
    hash = (hash << 5) - hash + environment.charCodeAt(index)
    hash |= 0
  }

  const hue = Math.abs(hash) % 360
  return `hsl(${String(hue)} 75% 55%)`
}

export function isDependencyEnabledInEnvironment(dependency: DependencyRecord, environment: string): boolean {
  if (!dependency.enabledIn || dependency.enabledIn.length === 0) {
    return true
  }

  if (environment.startsWith('preview/') && dependency.enabledIn.includes('preview')) {
    return true
  }

  if (dependency.enabledIn.includes(environment)) {
    return true
  }

  return false
}

export function isServiceInEnvironment(environments: string[], environment: string): boolean {
  if (environments.includes(environment)) {
    return true
  }

  if (environment.startsWith('preview/')) {
    return environments.includes('preview')
  }

  return false
}

export function resolveTargetEnvironment(
  sourceEnvironment: string,
  availableTargetEnvironments: string[],
  explicitTargetEnvironment?: string,
): string | null {
  if (availableTargetEnvironments.length === 0) {
    return null
  }

  if (explicitTargetEnvironment) {
    if (availableTargetEnvironments.includes(explicitTargetEnvironment)) {
      return explicitTargetEnvironment
    }

    if (explicitTargetEnvironment === 'preview') {
      if (sourceEnvironment.startsWith('preview/') && availableTargetEnvironments.includes(sourceEnvironment)) {
        return sourceEnvironment
      }

      if (availableTargetEnvironments.includes('preview')) {
        return 'preview'
      }
    }
  }

  if (availableTargetEnvironments.includes(sourceEnvironment)) {
    return sourceEnvironment
  }

  if (sourceEnvironment.startsWith('preview/') && availableTargetEnvironments.includes('preview')) {
    return 'preview'
  }

  const preferredFallbacks = ['production', 'staging', 'preview', 'development']
  for (const fallback of preferredFallbacks) {
    if (availableTargetEnvironments.includes(fallback)) {
      return fallback
    }
  }

  return availableTargetEnvironments[0] ?? null
}

export function computeServiceDepths(
  serviceIds: string[],
  dependencyIdsByServiceId: Map<string, string[]>,
): Map<string, number> {
  const depthMemo = new Map<string, number>()

  const computeDepth = (serviceId: string, stack: Set<string>): number => {
    const memoized = depthMemo.get(serviceId)
    if (memoized !== undefined) {
      return memoized
    }

    if (stack.has(serviceId)) {
      return 0
    }

    const nextStack = new Set(stack)
    nextStack.add(serviceId)
    const dependencies = dependencyIdsByServiceId.get(serviceId) ?? []

    let depth = 0
    for (const dependencyId of dependencies) {
      const dependencyDepth = computeDepth(dependencyId, nextStack) + 1
      depth = Math.max(depth, dependencyDepth)
    }

    depthMemo.set(serviceId, depth)
    return depth
  }

  for (const serviceId of serviceIds) {
    computeDepth(serviceId, new Set())
  }

  return depthMemo
}

