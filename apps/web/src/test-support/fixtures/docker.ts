import { ERROR_MESSAGE, refetchSpy, type Scenario } from '../scenario'
import { daysAgo, minutesAgo, type FixtureMap } from './types'

export const container = (over: Record<string, unknown> = {}) => ({
	id: 'c-api-1',
	hash: 'abc123def456',
	name: 'deployer-api',
	projectId: 'p-1',
	serviceId: 's-1',
	stackId: null,
	imageId: 'img-1',
	status: 'running',
	health: 'healthy',
	environment: 'production',
	cpuPercent: 4,
	memoryPercent: 22,
	restartCount: 0,
	ports: [{ containerPort: 3000, hostPort: 3001, protocol: 'tcp' }],
	networkIds: ['net-1'],
	volumeIds: ['vol-1'],
	managedBy: 'orphan',
	managedReason: null,
	managedDeploymentId: null,
	managedServiceId: null,
	managedProjectId: null,
	managedImageRef: null,
	managedNetworkMode: null,
	logsStreamId: null,
	startedAt: minutesAgo(120),
	createdAt: daysAgo(2),
	updatedAt: minutesAgo(5),
	...over,
})

export const image = (over: Record<string, unknown> = {}) => ({
	id: 'img-1',
	registry: 'docker.io',
	repository: 'acme/api',
	tag: '3.0.0',
	digest: 'sha256:0123456789abcdef',
	sizeBytes: 120_000_000,
	createdAt: daysAgo(3),
	lastSeenAt: minutesAgo(5),
	labels: {},
	...over,
})

export const network = (over: Record<string, unknown> = {}) => ({
	id: 'net-1',
	name: 'deployer_default',
	driver: 'bridge',
	scope: 'local',
	internal: false,
	attachable: true,
	subnet: '172.18.0.0/16',
	gateway: '172.18.0.1',
	containerIds: ['c-api-1'],
	labels: {},
	createdAt: daysAgo(30),
	updatedAt: daysAgo(1),
	...over,
})

export const volume = (over: Record<string, unknown> = {}) => ({
	id: 'vol-1',
	name: 'deployer_pgdata',
	driver: 'local',
	mountpoint: '/var/lib/docker/volumes/deployer_pgdata/_data',
	sizeBytes: 2_000_000_000,
	usedByContainerIds: ['c-api-1'],
	labels: {},
	createdAt: daysAgo(30),
	updatedAt: daysAgo(1),
	...over,
})

const dockerList = <T>(rows: T[]) => ({ data: rows, meta: { total: rows.length, limit: 100, offset: 0 } })

/** `useDockerRuntimeSseState()` is `{ status, ... }`, not a query. */
function sseState(state: Scenario) {
	switch (state) {
		case 'loading':
			return { status: 'connecting', lastError: null }
		case 'error':
			return { status: 'error', lastError: ERROR_MESSAGE }
		default:
			return { status: 'connected', lastError: null }
	}
}

/** A live stream that has not delivered anything: `{ event, events, data }` all empty. */
const streamIdle = { event: null, events: [], data: undefined, status: 'connected', detail: null }

/** The SSE-driven entity store behind `useDockerLive*`: rows, status and the last full sync. */
function liveStore<T extends { id: string }>(name: string, state: Scenario, rows: T[]) {
	const spy = refetchSpy(name)
	const refetch = () => {
		spy()
		return Promise.resolve()
	}
	const data = state === 'populated' ? rows : []
	const status = state === 'loading' ? 'connecting' : state === 'error' ? 'error' : 'connected'
	return {
		data,
		byId: new Map(data.map((row) => [row.id, row])),
		status,
		lastSyncedAt: state === 'empty' || state === 'populated' ? Date.now() : null,
		error: state === 'error' ? new Error(ERROR_MESSAGE) : null,
		refetch,
	}
}

const emptyCatalog = { containers: [], images: [], networks: [], volumes: [], registries: [], stacks: [] }

export const dockerFixtures: FixtureMap = {
	useDockerContainerList: { empty: dockerList([]), populated: dockerList([container(), container({ id: 'c-db-1', name: 'deployer-db', status: 'exited', health: 'none', updatedAt: minutesAgo(60) })]) },
	useDockerContainerGroupedList: { empty: dockerList([]), populated: dockerList([]) },
	useDockerContainerLinkedList: { empty: dockerList([]), populated: dockerList([]) },
	useDockerImageList: { empty: dockerList([]), populated: dockerList([image(), image({ id: 'img-2', repository: 'library/postgres', tag: '16' })]) },
	useDockerNetworkList: { empty: dockerList([]), populated: dockerList([network()]) },
	useDockerVolumeList: { empty: dockerList([]), populated: dockerList([volume()]) },
	useDockerServiceList: { empty: dockerList([]), populated: dockerList([]) },
	useDockerDeploymentList: { empty: dockerList([]), populated: dockerList([]) },
	useDockerRuntimeSnapshot: { empty: emptyCatalog, populated: { ...emptyCatalog, containers: [container()], images: [image()], networks: [network()], volumes: [volume()] } },
	useDockerRuntimeSseState: { empty: undefined, raw: sseState },
	useDockerRuntimeActivityList: { empty: dockerList([]), populated: dockerList([]) },
	useDockerLiveRefetch: { empty: undefined, raw: () => undefined },
	useDockerLiveContainers: { empty: undefined, raw: (state: Scenario) => liveStore('useDockerLiveContainers', state, [container(), container({ id: 'c-db-1', name: 'deployer-db', status: 'exited', health: 'none' })]) },
	useDockerLiveImages: { empty: undefined, raw: (state: Scenario) => liveStore('useDockerLiveImages', state, [image(), image({ id: 'img-2', repository: 'library/postgres', tag: '16' })]) },
	useDockerContainerLogsStream: { empty: undefined, raw: () => ({ lines: [], status: 'connected' }) },
	useDockerContainerLogsSnapshot: { empty: dockerList([]), populated: dockerList([]) },
	useDockerImageInspect: { empty: undefined },
	useDockerRuntimeEntityDetail: { empty: undefined },
	useDockerRuntimeActivityDetail: { empty: undefined },
	useDockerContainerInspect: { empty: undefined },
	useDockerContainerFiles: { empty: undefined },
	useDockerContainerReadFile: { empty: undefined },
	useDockerContainerProcesses: { empty: undefined },
	useDockerImageInspectStream: { empty: undefined, raw: () => undefined },
	useDockerNetworkEventsStream: { empty: undefined, raw: () => streamIdle },
	useDockerVolumeEventsStream: { empty: undefined, raw: () => streamIdle },
	useDockerImageEventsStream: { empty: undefined, raw: () => streamIdle },
	useDockerContainerEventsStream: { empty: undefined, raw: () => streamIdle },
	useDockerContainerProcessesStream: { empty: undefined, raw: () => streamIdle },
	useDockerContainerProcessLogsStream: { empty: undefined, raw: () => streamIdle },
	useDockerContainerTerminalSessionStream: { empty: undefined, raw: () => streamIdle },
	useDockerImageSecurityScanStream: { empty: undefined, raw: () => streamIdle },
	useDockerRuntimeEventSubscriber: { empty: undefined, raw: () => undefined },
	useDockerFleetServers: { empty: { items: [] }, populated: { items: [] } },
}
