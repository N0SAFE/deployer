import type { DockerRuntimeActivityEntity } from '@repo/contracts-entities'
import { isRecord } from '@repo/type-guards'

/** Best human name for the resource an event is about. */
export function resolveResourceName(activity: DockerRuntimeActivityEntity): string {
  const payload = isRecord(activity.payload) ? activity.payload : {}
  const candidates = [
    payload.containerName,
    payload.imageName,
    payload.repository,
    payload.networkName,
    payload.volumeName,
    payload.serviceName,
    payload.daemonName,
    payload.builderName,
    activity.actorId,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate
  }
  return activity.source
}

export function resolveContainerId(activity: DockerRuntimeActivityEntity): string | undefined {
  const payload = isRecord(activity.payload) ? activity.payload : {}
  const candidate = typeof payload.containerId === 'string'
    ? payload.containerId
    : activity.source === 'container' && typeof activity.actorId === 'string'
      ? activity.actorId
      : undefined
  return candidate && candidate.trim().length > 0 ? candidate : undefined
}

/**
 * The reason an operator needs when a swarm workload will not come up. Swarm
 * events carry no state themselves; the server attaches the task error, and it
 * leads the row because it is the only actionable line.
 */
export function resolveSwarmTaskErrors(activity: DockerRuntimeActivityEntity): string[] {
  return activity.swarmTasks
    .map((task) => task.error)
    .filter((error): error is string => typeof error === 'string' && error.trim().length > 0)
}

/** "2 of 3 tasks running" — the scale context a swarm event never carries. */
export function resolveSwarmSummary(activity: DockerRuntimeActivityEntity): string | null {
  const service = activity.swarmService
  if (!service) return null
  return `${String(service.runningTasks)} of ${String(service.desiredTasks)} tasks running`
}
