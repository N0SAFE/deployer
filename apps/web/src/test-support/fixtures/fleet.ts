import { ERROR_MESSAGE, type Scenario } from '../scenario'
import { daysAgo, minutesAgo, type FixtureMap } from './types'

export const NODE_A = '0190a000-0000-7000-8000-00000000000a'
export const NODE_B = '0190a000-0000-7000-8000-00000000000b'
export const NODE_C = '0190a000-0000-7000-8000-00000000000c'

export const fleetServer = (over: Record<string, unknown> = {}) => ({
	nodeId: NODE_A,
	swarmNodeId: 'swarm-a',
	serverUrl: 'https://alpha.example.test',
	displayName: 'alpha',
	status: 'active',
	healthy: true,
	lastSeenAt: minutesAgo(1),
	maxCpuMillicores: 4000,
	maxMemoryMb: 8192,
	metrics: { cpuUsage: 0.25, memoryUsage: 0.5, activeStreams: 1, queueDepth: 0, reportedAt: minutesAgo(1) },
	allocationSummary: { services: 2, cpuMillicores: 1000, memoryMb: 2048 },
	...over,
})

export const fleetServers = {
	items: [
		fleetServer(),
		fleetServer({ nodeId: NODE_B, swarmNodeId: 'swarm-b', serverUrl: 'https://bravo.example.test', displayName: 'bravo', lastSeenAt: minutesAgo(2) }),
		fleetServer({ nodeId: NODE_C, swarmNodeId: 'swarm-c', serverUrl: 'https://charlie.example.test', displayName: null, lastSeenAt: daysAgo(5), metrics: null }),
	],
}

export const allocation = (over: Record<string, unknown> = {}) => ({
	id: '0190a000-0000-7000-8000-0000000000a1',
	serverNodeId: NODE_A,
	serverUrl: 'https://alpha.example.test',
	allocationMode: 'shared_slice',
	cpuMillicores: 1000,
	memoryMb: 2048,
	maxServices: 4,
	isEnabled: true,
	updatedAt: minutesAgo(30),
	...over,
})

export const admissionRequest = {
	id: '0190a000-0000-7000-8000-0000000000b1',
	status: 'pending',
	requestedServerNodeId: NODE_A,
	decisionServerNodeId: null,
	requestedCpuMillicores: 500,
	requestedMemoryMb: 512,
	requestedServices: 1,
	requesterUserId: 'user-1',
	requesterNote: 'staging api',
	reviewedByUserId: null,
	reviewerNote: null,
	reviewedAt: null,
	createdAt: minutesAgo(10),
	updatedAt: minutesAgo(10),
}

export const meshNodeState = (over: Record<string, unknown> = {}) => ({
	nodeId: NODE_A,
	region: 'eu-west',
	roles: ['edge'],
	lifecycleState: 'healthy',
	routingMode: 'balanced',
	consistencyMode: 'ap',
	version: '3.0.0',
	startedAt: minutesAgo(600),
	lastSeenAt: minutesAgo(1),
	metadata: null,
	...over,
})

export const meshState = (nodes: unknown[] = [meshNodeState()]) => ({
	type: 'mesh_state',
	reason: 'bootstrap',
	localNode: meshNodeState(),
	peers: [],
	sessions: [],
	snapshot: { version: 1, generatedAt: minutesAgo(1), localNode: meshNodeState(), nodes, connections: [], sessions: [] },
	topologyEvent: null,
	emittedAt: minutesAgo(1),
	revision: 1,
})

export const meshNodeConfig = {
	nodeId: NODE_A,
	strategy: 'local',
	meshUrlsSnapshot: [],
	databaseUrl: 'postgres://postgres@db:5432/deployer',
	configuredAt: minutesAgo(600),
	updatedAt: minutesAgo(600),
	meshSharedSecretUpdatedAt: null,
	region: 'eu-west',
	roles: ['edge'],
	version: '3.0.0',
	routingMode: 'balanced',
	consistencyMode: 'ap',
	lifecycleState: 'healthy',
	startedAt: minutesAgo(600),
	lastSeenAt: minutesAgo(1),
}

/** `useMeshSseState()` is not a query: it returns `{ status, lastError, state }`. */
function sseState(state: Scenario) {
	switch (state) {
		case 'loading':
			return { status: 'connecting', lastError: null, state: null }
		case 'error':
			return { status: 'error', lastError: ERROR_MESSAGE, state: null }
		case 'empty':
			return { status: 'connected', lastError: null, state: meshState([]) }
		case 'populated':
			return { status: 'connected', lastError: null, state: meshState([meshNodeState(), meshNodeState({ nodeId: NODE_B, lifecycleState: 'degraded' })]) }
	}
}

export const fleetFixtures: FixtureMap = {
	useFleetServers: { empty: { items: [] }, populated: fleetServers },
	useFleetAllocations: { empty: { items: [] }, populated: { items: [allocation(), allocation({ id: '0190a000-0000-7000-8000-0000000000a2', serverNodeId: NODE_B })] } },
	useFleetAdmissionRequests: { empty: { items: [] }, populated: { items: [admissionRequest] } },
	useMeshLocalNode: { empty: undefined, populated: meshNodeState() },
	useMeshNodeConfig: { empty: undefined, populated: meshNodeConfig },
	useMeshSseState: { empty: undefined, raw: sseState },
}

