import z from 'zod/v4'
import type { ContainerFormState } from './container-form.model'

/** Field schemas and whole-form validation for the create-container form. Pure, no React. */


// ---------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------

export const containerNameSchema = z
  .string()
  .min(1, 'Name the container.')
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, 'Use letters, digits, "_", "." or "-", starting with a letter or digit.')

export const imageRefSchema = z
  .string()
  .min(1, 'Choose the image to run.')
  .regex(/^\S+$/, 'An image reference cannot contain spaces.')

export const portNumberSchema = z
  .string()
  .regex(/^\d+$/, 'Enter a port number (1–65535).')
  .refine((value) => Number(value) >= 1 && Number(value) <= 65535, 'Port must be between 1 and 65535.')

export const envKeySchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Use letters, digits and "_", not starting with a digit.')

const positiveInt = (what: string, min = 1) =>
  z.string().regex(/^\d+$/, `${what} must be a whole number.`).refine((v) => Number(v) >= min, `${what} must be at least ${String(min)}.`)

const positiveNumber = (what: string) =>
  z.string().refine((v) => Number.isFinite(Number(v)) && Number(v) > 0, `${what} must be a number above 0.`)

const absolutePathSchema = z.string().regex(/^\//, 'Use an absolute path starting with "/".')
const hostSourceSchema = z.string().regex(/^(\/|[a-zA-Z0-9][a-zA-Z0-9_.-]*$)/, 'Use an absolute path, or a named volume.')

function issue(schema: z.ZodType, value: string): string | undefined {
  const result = schema.safeParse(value)
  return result.success ? undefined : result.error.issues[0]?.message
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Flat map keyed like `name`, `ports.0.hostPort`, `envVars.2.key`. */
export type FormErrors = Record<string, string>

export const isBlank = (value: string): boolean => value.trim().length === 0

function flagDuplicates(errors: FormErrors, keys: string[], listKey: string, field: string, message: string): void {
  const seen = new Set<string>()
  keys.forEach((key, index) => {
    if (isBlank(key)) return
    if (seen.has(key)) errors[`${listKey}.${String(index)}.${field}`] = message
    seen.add(key)
  })
}

function validateRestart(state: ContainerFormState, errors: FormErrors): void {
  if (state.restartPolicy !== 'on-failure' || isBlank(state.restartMaxRetries)) return
  const message = issue(positiveInt('Max retries', 0), state.restartMaxRetries.trim())
  if (message) errors.restartMaxRetries = message
}

function validatePorts(state: ContainerFormState, errors: FormErrors): void {
  const bound = new Set<string>()
  state.ports.forEach((row, index) => {
    const host = row.hostPort.trim()
    const container = row.containerPort.trim()
    if (!host && !container) return
    const at = (field: string) => `ports.${String(index)}.${field}`
    const hostIssue = host ? issue(portNumberSchema, host) : 'Enter the host port to publish on.'
    const containerIssue = container ? issue(portNumberSchema, container) : 'Enter the port the app listens on.'
    if (hostIssue) errors[at('hostPort')] = hostIssue
    if (containerIssue) errors[at('containerPort')] = containerIssue
    if (!hostIssue) {
      const binding = `${host}/${row.protocol}`
      if (bound.has(binding)) errors[at('hostPort')] = `Host port ${host}/${row.protocol} is already published above.`
      bound.add(binding)
    }
  })
}

function validateVolumes(state: ContainerFormState, errors: FormErrors): void {
  const targets = new Set<string>()
  state.volumes.forEach((row, index) => {
    const host = row.hostPath.trim()
    const container = row.containerPath.trim()
    if (!host && !container) return
    const at = (field: string) => `volumes.${String(index)}.${field}`
    const hostIssue = host ? issue(hostSourceSchema, host) : 'Enter the host path or volume name.'
    const containerIssue = container ? issue(absolutePathSchema, container) : 'Enter where to mount it in the container.'
    if (hostIssue) errors[at('hostPath')] = hostIssue
    if (containerIssue) errors[at('containerPath')] = containerIssue
    if (!containerIssue) {
      if (targets.has(container)) errors[at('containerPath')] = `${container} is already a mount target above.`
      targets.add(container)
    }
  })
}

function validateKeyValues(state: ContainerFormState, errors: FormErrors, listKey: 'envVars' | 'labels'): void {
  const rows = state[listKey]
  rows.forEach((row, index) => {
    if (isBlank(row.key) && isBlank(row.value)) return
    const at = `${listKey}.${String(index)}.key`
    if (isBlank(row.key)) {
      errors[at] = listKey === 'envVars' ? 'Give the variable a name.' : 'Give the label a key.'
      return
    }
    if (listKey === 'envVars') {
      const message = issue(envKeySchema, row.key.trim())
      if (message) errors[at] = message
    } else if (/\s/.test(row.key.trim())) {
      errors[at] = 'A label key cannot contain spaces.'
    }
  })
  flagDuplicates(errors, rows.map((row) => row.key.trim()), listKey, 'key', listKey === 'envVars' ? 'This variable is already set above.' : 'This label is already set above.')
}

function validateResources(state: ContainerFormState, errors: FormErrors): void {
  const checks: [keyof ContainerFormState, z.ZodType, string][] = [
    ['memoryLimitMb', positiveInt('Memory limit', 6), state.memoryLimitMb],
    ['memoryReservationMb', positiveInt('Memory reservation'), state.memoryReservationMb],
    ['cpuLimit', positiveNumber('CPU limit'), state.cpuLimit],
    ['cpuShares', positiveInt('CPU shares', 2), state.cpuShares],
    ['cpuQuota', positiveInt('CPU quota'), state.cpuQuota],
    ['cpuPeriod', positiveInt('CPU period', 1000), state.cpuPeriod],
  ]
  for (const [field, schema, raw] of checks) {
    if (isBlank(raw)) continue
    const message = issue(schema, raw.trim())
    if (message) errors[field] = message
  }
  if (!errors.memoryLimitMb && !errors.memoryReservationMb && !isBlank(state.memoryLimitMb) && !isBlank(state.memoryReservationMb)
    && Number(state.memoryReservationMb) > Number(state.memoryLimitMb)) {
    errors.memoryReservationMb = 'The reservation cannot exceed the memory limit.'
  }
}

function validateAdvanced(state: ContainerFormState, errors: FormErrors): void {
  if (state.healthcheckEnabled) {
    if (isBlank(state.healthcheckCommand)) errors.healthcheckCommand = 'Enter the command that reports health.'
    const message = issue(positiveInt('Interval'), state.healthcheckIntervalSec.trim())
    if (message) errors.healthcheckIntervalSec = message
  }
  if (state.autoUpdateEnabled && state.autoUpdateCron.trim().split(/\s+/).length !== 5) {
    errors.autoUpdateCron = 'A cron expression has 5 fields, e.g. 0 3 * * *.'
  }
  if (state.gpuEnabled && state.gpuMode === 'count') {
    const message = issue(positiveInt('GPU count'), state.gpuCount.trim())
    if (message) errors.gpuCount = message
  }
  state.devices.forEach((row, index) => {
    if (isBlank(row.hostPath) && isBlank(row.containerPath)) return
    const hostIssue = issue(absolutePathSchema, row.hostPath.trim())
    const containerIssue = issue(absolutePathSchema, row.containerPath.trim())
    if (hostIssue) errors[`devices.${String(index)}.hostPath`] = hostIssue
    if (containerIssue) errors[`devices.${String(index)}.containerPath`] = containerIssue
  })
  state.ulimits.forEach((row, index) => {
    if (isBlank(row.soft) && isBlank(row.hard)) return
    const soft = issue(positiveInt('Soft limit', 0), row.soft.trim())
    const hard = issue(positiveInt('Hard limit', 0), row.hard.trim())
    if (soft) errors[`ulimits.${String(index)}.soft`] = soft
    if (hard) errors[`ulimits.${String(index)}.hard`] = hard
    if (!soft && !hard && Number(row.soft) > Number(row.hard)) errors[`ulimits.${String(index)}.soft`] = 'Soft limit cannot exceed the hard limit.'
  })
}

export function validateForm(state: ContainerFormState): FormErrors {
  const errors: FormErrors = {}
  const name = issue(containerNameSchema, state.name.trim())
  if (name) errors.name = name
  const image = issue(imageRefSchema, state.image.trim())
  if (image) errors.image = image
  validateRestart(state, errors)
  validatePorts(state, errors)
  validateVolumes(state, errors)
  validateKeyValues(state, errors, 'envVars')
  validateKeyValues(state, errors, 'labels')
  validateResources(state, errors)
  validateAdvanced(state, errors)
  return errors
}

/** Human labels for the "fix N fields" reason shown next to the disabled submit button. */
export function describeErrorField(key: string): string {
  const [head, index, field] = key.split('.')
  const row = index === undefined ? '' : ` ${String(Number(index) + 1)}`
  const labels: Record<string, string> = {
    name: 'Container name', image: 'Image', restartMaxRetries: 'Max retries', ports: 'Port', volumes: 'Volume',
    envVars: 'Environment variable', labels: 'Label', memoryLimitMb: 'Memory limit', memoryReservationMb: 'Memory reservation',
    cpuLimit: 'CPU limit', cpuShares: 'CPU shares', cpuQuota: 'CPU quota', cpuPeriod: 'CPU period',
    healthcheckCommand: 'Healthcheck command', healthcheckIntervalSec: 'Healthcheck interval', autoUpdateCron: 'Auto-update cron',
    gpuCount: 'GPU count', devices: 'Device', ulimits: 'Ulimit',
  }
  const base = labels[head ?? ''] ?? key
  return `${base}${row}${field && head !== 'envVars' && head !== 'labels' ? ` (${field})` : ''}`
}
