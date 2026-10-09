import { z } from 'zod'

/**
 * Pure model of the "create container" form: state shape, field-level zod
 * schemas, whole-form validation and payload building. No React in here so the
 * rules are unit-testable.
 */

export type RestartPolicy = 'no' | 'always' | 'unless-stopped' | 'on-failure'
export type Protocol = 'tcp' | 'udp'
export type GpuMode = 'all' | 'count' | 'specific'
export type VulnerabilityCriteria = 'never' | 'critical' | 'high' | 'medium' | 'low' | 'any'

export interface PortRow { hostPort: string; containerPort: string; protocol: Protocol }
export interface VolumeRow { hostPath: string; containerPath: string; mode: 'rw' | 'ro' }
export interface KeyValueRow { key: string; value: string }
export interface DeviceRow { hostPath: string; containerPath: string; permissions: string }
export interface UlimitRow { name: string; soft: string; hard: string }

/** Every field is the raw string typed by the operator; numbers are parsed in `buildPayload`. */
export interface ContainerFormState {
  name: string
  image: string
  command: string
  restartPolicy: RestartPolicy
  restartMaxRetries: string
  networkMode: string
  selectedNetworks: string[]
  startAfterCreate: boolean
  repullImage: boolean
  containerUser: string
  ports: PortRow[]
  volumes: VolumeRow[]
  envVars: KeyValueRow[]
  labels: KeyValueRow[]
  memoryLimitMb: string
  memoryReservationMb: string
  cpuLimit: string
  cpuShares: string
  cpuQuota: string
  cpuPeriod: string
  privilegedMode: boolean
  readOnlyRootFs: boolean
  capAdd: string[]
  capDrop: string[]
  securityOptions: string[]
  dnsServers: string[]
  dnsSearch: string[]
  dnsOptions: string[]
  devices: DeviceRow[]
  ulimits: UlimitRow[]
  gpuEnabled: boolean
  gpuMode: GpuMode
  gpuCount: string
  gpuDeviceIds: string[]
  gpuDriver: string
  gpuCapabilities: string[]
  runtime: string
  autoUpdateEnabled: boolean
  autoUpdateCron: string
  vulnerabilityCriteria: VulnerabilityCriteria
  healthcheckEnabled: boolean
  healthcheckCommand: string
  healthcheckIntervalSec: string
  selectedConfigSetId: string
}

export type ListKey = 'ports' | 'volumes' | 'envVars' | 'labels' | 'devices' | 'ulimits'

export interface PullScanSummary {
  pullStatus: 'idle' | 'pulling' | 'complete' | 'error'
  scanStatus: 'idle' | 'scanning' | 'complete' | 'error'
  vulnerabilities: { critical: number; high: number; medium: number; low: number }
}

export interface DockerCreateContainerPayload {
  name: string
  image: string
  command: string
  restartPolicy: RestartPolicy
  restartMaxRetries: number | null
  networkMode: string
  selectedNetworks: string[]
  startAfterCreate: boolean
  repullImage: boolean
  containerUser: string
  privilegedMode: boolean
  readOnlyRootFs: boolean
  healthcheckEnabled: boolean
  healthcheckCommand: string
  healthcheckIntervalSec: number
  memoryLimitMb: number | null
  memoryReservationMb: number | null
  cpuShares: number | null
  cpuQuota: number | null
  cpuPeriod: number | null
  cpuLimit: number | null
  capAdd: string[]
  capDrop: string[]
  securityOptions: string[]
  dnsServers: string[]
  dnsSearch: string[]
  dnsOptions: string[]
  devices: DeviceRow[]
  ulimits: { name: string; soft: number; hard: number }[]
  gpu: {
    enabled: boolean
    mode: GpuMode
    count: number
    deviceIds: string[]
    driver: string
    capabilities: string[]
    runtime: string
  }
  autoUpdate: { enabled: boolean; cronExpression: string; vulnerabilityCriteria: VulnerabilityCriteria }
  envVars: KeyValueRow[]
  labels: KeyValueRow[]
  ports: PortRow[]
  volumes: VolumeRow[]
  pullScanSummary: PullScanSummary
}

export const DEFAULT_CRON = '0 3 * * *'

export function createInitialState(prefilledImage?: string): ContainerFormState {
  return {
    name: prefilledImage ? `${slugify(prefilledImage.split('/').at(-1) ?? 'container')}-run` : '',
    image: prefilledImage ?? '',
    command: '',
    restartPolicy: 'no',
    restartMaxRetries: '',
    networkMode: 'bridge',
    selectedNetworks: [],
    startAfterCreate: true,
    repullImage: true,
    containerUser: '',
    ports: [emptyRow('ports')],
    volumes: [emptyRow('volumes')],
    envVars: [emptyRow('envVars')],
    labels: [emptyRow('labels')],
    memoryLimitMb: '',
    memoryReservationMb: '',
    cpuLimit: '',
    cpuShares: '',
    cpuQuota: '',
    cpuPeriod: '',
    privilegedMode: false,
    readOnlyRootFs: false,
    capAdd: [],
    capDrop: [],
    securityOptions: [],
    dnsServers: [],
    dnsSearch: [],
    dnsOptions: [],
    devices: [],
    ulimits: [],
    gpuEnabled: false,
    gpuMode: 'all',
    gpuCount: '1',
    gpuDeviceIds: [],
    gpuDriver: '',
    gpuCapabilities: ['gpu'],
    runtime: '',
    autoUpdateEnabled: false,
    autoUpdateCron: DEFAULT_CRON,
    vulnerabilityCriteria: 'never',
    healthcheckEnabled: false,
    healthcheckCommand: '',
    healthcheckIntervalSec: '30',
    selectedConfigSetId: '',
  }
}

type RowOf<K extends ListKey> = ContainerFormState[K][number]

export function emptyRow<K extends ListKey>(key: K): RowOf<K> {
  const rows: { [P in ListKey]: ContainerFormState[P][number] } = {
    ports: { hostPort: '', containerPort: '', protocol: 'tcp' },
    volumes: { hostPath: '', containerPath: '', mode: 'rw' },
    envVars: { key: '', value: '' },
    labels: { key: '', value: '' },
    devices: { hostPath: '', containerPath: '', permissions: 'rwm' },
    ulimits: { name: 'nofile', soft: '', hard: '' },
  }
  return { ...rows[key] }
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

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

const isBlank = (value: string): boolean => value.trim().length === 0

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

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

const numOrNull = (raw: string): number | null => (isBlank(raw) ? null : Number(raw))

/** Rows that have content in every required cell; partial rows are rejected by `validateForm`. */
export function completePorts(rows: PortRow[]): PortRow[] {
  return rows.filter((row) => row.containerPort.trim() && row.hostPort.trim())
}
export function completeVolumes(rows: VolumeRow[]): VolumeRow[] {
  return rows.filter((row) => row.hostPath.trim() && row.containerPath.trim())
}
export function completeKeyValues(rows: KeyValueRow[]): KeyValueRow[] {
  return rows.filter((row) => row.key.trim().length > 0)
}

export function buildPayload(state: ContainerFormState, summary: PullScanSummary): DockerCreateContainerPayload {
  return {
    name: state.name.trim(),
    image: state.image.trim(),
    command: state.command.trim(),
    restartPolicy: state.restartPolicy,
    restartMaxRetries: state.restartPolicy === 'on-failure' ? numOrNull(state.restartMaxRetries) : null,
    networkMode: state.networkMode,
    selectedNetworks: state.selectedNetworks,
    startAfterCreate: state.startAfterCreate,
    repullImage: state.repullImage,
    containerUser: state.containerUser.trim(),
    privilegedMode: state.privilegedMode,
    readOnlyRootFs: state.readOnlyRootFs,
    healthcheckEnabled: state.healthcheckEnabled,
    healthcheckCommand: state.healthcheckCommand.trim(),
    healthcheckIntervalSec: Number(state.healthcheckIntervalSec) || 30,
    memoryLimitMb: numOrNull(state.memoryLimitMb),
    memoryReservationMb: numOrNull(state.memoryReservationMb),
    cpuShares: numOrNull(state.cpuShares),
    cpuQuota: numOrNull(state.cpuQuota),
    cpuPeriod: numOrNull(state.cpuPeriod),
    cpuLimit: numOrNull(state.cpuLimit),
    capAdd: state.capAdd,
    capDrop: state.capDrop,
    securityOptions: state.securityOptions,
    dnsServers: state.dnsServers,
    dnsSearch: state.dnsSearch,
    dnsOptions: state.dnsOptions,
    devices: state.devices.filter((row) => row.hostPath.trim() && row.containerPath.trim()),
    ulimits: state.ulimits
      .filter((row) => row.name.trim() && row.soft.trim() && row.hard.trim())
      .map((row) => ({ name: row.name, soft: Number(row.soft), hard: Number(row.hard) })),
    gpu: {
      enabled: state.gpuEnabled,
      mode: state.gpuMode,
      count: Number(state.gpuCount) || 1,
      deviceIds: state.gpuDeviceIds,
      driver: state.gpuDriver.trim(),
      capabilities: state.gpuCapabilities,
      runtime: state.runtime.trim(),
    },
    autoUpdate: {
      enabled: state.autoUpdateEnabled,
      cronExpression: state.autoUpdateCron.trim(),
      vulnerabilityCriteria: state.vulnerabilityCriteria,
    },
    envVars: completeKeyValues(state.envVars),
    labels: completeKeyValues(state.labels),
    ports: completePorts(state.ports),
    volumes: completeVolumes(state.volumes),
    pullScanSummary: summary,
  }
}

export function formatPortBinding(row: PortRow): string {
  return `${row.hostPort.trim()}:${row.containerPort.trim()}/${row.protocol}`
}

export interface ConfigPreset {
  id: string
  name: string
  description: string
  patch: Partial<ContainerFormState>
}

export const CONFIG_PRESETS: ConfigPreset[] = [
  {
    id: 'web',
    name: 'Web service baseline',
    description: 'HTTP service on 8080 → 3000, restarts unless stopped',
    patch: {
      envVars: [{ key: 'NODE_ENV', value: 'production' }],
      ports: [{ hostPort: '8080', containerPort: '3000', protocol: 'tcp' }],
      restartPolicy: 'unless-stopped',
      networkMode: 'bridge',
    },
  },
  {
    id: 'worker',
    name: 'Worker baseline',
    description: 'Background worker that always restarts',
    patch: {
      envVars: [{ key: 'WORKER_CONCURRENCY', value: '4' }],
      restartPolicy: 'always',
      networkMode: 'bridge',
    },
  },
]
