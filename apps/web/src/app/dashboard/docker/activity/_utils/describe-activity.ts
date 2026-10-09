/**
 * Pure wording for engine events: turns `container` + `die` + `web-1` into
 * "Container web-1 exited". No React, no formatting of times.
 */

export type ActivityKind = 'container' | 'image' | 'network' | 'volume' | 'swarm' | 'other'

export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  container: 'Containers',
  image: 'Images',
  network: 'Networks',
  volume: 'Volumes',
  swarm: 'Swarm',
  other: 'Other',
}

const SWARM_SOURCES: ReadonlySet<string> = new Set(['service', 'node', 'task'])

export function activityKind(source: string): ActivityKind {
  if (source === 'container' || source === 'image' || source === 'network' || source === 'volume') return source
  return SWARM_SOURCES.has(source) ? 'swarm' : 'other'
}

const NOUNS: Record<string, string> = {
  container: 'Container',
  image: 'Image',
  network: 'Network',
  volume: 'Volume',
  service: 'Service',
  node: 'Node',
  task: 'Task',
  daemon: 'Docker daemon',
  builder: 'Builder',
  config: 'Config',
  secret: 'Secret',
  plugin: 'Plugin',
}

const VERBS: Record<string, Record<string, string>> = {
  container: {
    create: 'was created', start: 'started', stop: 'stopped', die: 'exited', kill: 'was killed',
    destroy: 'was removed', remove: 'was removed', restart: 'restarted', pause: 'was paused',
    unpause: 'was resumed', oom: 'ran out of memory', rename: 'was renamed', update: 'was updated',
    attach: 'was attached to', detach: 'was detached from', commit: 'was committed to an image',
    exec_start: 'ran a command', exec_create: 'is about to run a command', exec_die: 'finished a command',
    resize: 'was resized', top: 'was inspected',
  },
  image: {
    pull: 'was pulled', push: 'was pushed', tag: 'was tagged', untag: 'was untagged',
    delete: 'was deleted', remove: 'was deleted', import: 'was imported', save: 'was saved', load: 'was loaded',
  },
  network: {
    create: 'was created', destroy: 'was removed', remove: 'was removed',
    connect: 'had a container connected', disconnect: 'had a container disconnected', prune: 'was pruned',
  },
  volume: {
    create: 'was created', destroy: 'was removed', remove: 'was removed',
    mount: 'was mounted', unmount: 'was unmounted', prune: 'was pruned',
  },
  service: { create: 'was created', update: 'was updated', remove: 'was removed' },
  node: { create: 'joined the swarm', update: 'was updated', remove: 'left the swarm' },
  task: { create: 'was scheduled', update: 'changed state', remove: 'was removed' },
  daemon: { reload: 'configuration was reloaded' },
}

/** `health_status: unhealthy` -> base `health_status`, detail `unhealthy`. */
function splitAction(action: string): { base: string; detail: string | null } {
  const index = action.indexOf(':')
  if (index === -1) return { base: action.trim(), detail: null }
  const detail = action.slice(index + 1).trim()
  return { base: action.slice(0, index).trim(), detail: detail.length > 0 ? detail : null }
}

function humanize(value: string): string {
  return value.replace(/[_.]+/g, ' ').trim().toLowerCase()
}

/** "Container web-1 stopped". Unknown actions degrade to the humanized action, never a raw code. */
export function describeActivity(input: { source: string; action: string; resourceName: string }): string {
  const noun = NOUNS[input.source] ?? humanize(input.source).replace(/^./, (c) => c.toUpperCase())
  const { base, detail } = splitAction(input.action)
  const subject = `${noun} ${input.resourceName}`

  if (base === 'health_status') {
    return detail ? `${subject} health check: ${detail}` : `${subject} health status changed`
  }
  const verb = VERBS[input.source]?.[base]
  if (verb) {
    if (base.startsWith('exec_') && detail) return `${subject} ${verb}: ${detail}`
    return `${subject} ${verb}`
  }
  return `${subject}: ${humanize(input.action)}`
}
