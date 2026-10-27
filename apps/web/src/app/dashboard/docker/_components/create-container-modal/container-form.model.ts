import { isBlank } from './container-form.validation'

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
