import type { IngressState } from '@deployer/fleet-contracts'
import { minutesAgo, daysAgo, type FixtureMap } from './types'

export const node = (over: Record<string, unknown> = {}) => ({
	nodeId: 'node-1',
	hostname: 'alpha',
	swarmRole: 'manager',
	platformRole: 'both',
	isMaster: true,
	isIngress: true,
	isLeader: true,
	availability: 'active',
	capacity: { nanoCpus: 4_000_000_000, memoryBytes: 8_000_000_000 },
	labels: {},
	state: 'active',
	lastHeartbeatAt: minutesAgo(1),
	lastSeenAt: minutesAgo(1),
	...over,
})

export const clusterNodes = [
	node(),
	node({ nodeId: 'node-2', hostname: 'bravo', swarmRole: 'worker', isMaster: false, isIngress: false, isLeader: false, lastSeenAt: minutesAgo(2), lastHeartbeatAt: minutesAgo(2) }),
	node({ nodeId: 'node-3', hostname: 'charlie', swarmRole: 'worker', isMaster: false, isIngress: false, isLeader: false, state: 'down', lastSeenAt: daysAgo(3), lastHeartbeatAt: daysAgo(3) }),
]

export const clusterSnapshot = {
	clusterId: 'cluster-1',
	clusterName: 'home',
	localNodeState: 'active',
	controlAvailable: true,
	nodeCount: 3,
	managerCount: 1,
	localNode: node(),
	master: { nodeId: 'node-1', term: 1, electedAt: minutesAgo(600), heartbeatAt: minutesAgo(1), reason: 'bootstrap' },
	membership: { nodeId: 'node-1', state: 'active', joinedAt: minutesAgo(600) },
	joinTokens: null,
}

export const emptyIngress: IngressState = {
	lanes: { entryPort: 80, private: { enabled: false, domain: 'deployer.internal', exposeOnLan: false }, public: null, consoleVisibility: 'public' },
	exposure: { reachableOffMachine: false, reachableFromInternet: false, opensInboundPorts: false, usesProviderAccount: false, reachableOnLan: false },
	domains: { local: 'deployer.localhost', private: null, public: null },
	consoleUrls: { local: 'http://web.deployer.localhost', private: null, public: null },
	edge: { providers: [], active: null },
	dns: [],
	mesh: { available: true, clusterId: null, cidr: null, address: null, listenPort: null, interfaceUp: false, members: [], doors: [], lastGossipAt: null, lastError: null },
	entryPoints: { joinable: false, preferred: null, points: [] },
}

export const populatedIngress: IngressState = {
	...emptyIngress,
	lanes: { ...emptyIngress.lanes, private: { enabled: true, domain: 'deployer.internal', exposeOnLan: false } },
	exposure: { ...emptyIngress.exposure, reachableOffMachine: true },
	domains: { local: 'deployer.localhost', private: 'deployer.internal', public: null },
	consoleUrls: { local: 'http://web.deployer.localhost', private: 'http://web.deployer.internal', public: null },
	mesh: {
		available: true,
		clusterId: 'mesh-1',
		cidr: '10.77.0.0/24',
		address: '10.77.0.1',
		listenPort: 51820,
		interfaceUp: true,
		members: [
			{ memberId: 'm-1', name: 'alpha', kind: 'node', address: '10.77.0.1', state: 'active', self: true, labels: {}, endpoints: [], link: { path: 'self', endpoint: null, latestHandshakeAt: null } },
			{ memberId: 'm-2', name: 'bravo', kind: 'node', address: '10.77.0.2', state: 'active', self: false, labels: {}, endpoints: [{ kind: 'lan', address: '192.168.1.20:51820' }], link: { path: 'direct', endpoint: '192.168.1.20:51820', latestHandshakeAt: minutesAgo(1) } },
		],
		doors: [{ lane: 'local', container: 'door-local', bindAddress: '127.0.0.1', port: 80, state: 'running', detail: null }],
		lastGossipAt: minutesAgo(1),
		lastError: null,
	},
}

export const emptyMetrics = {
	dataSource: 'unavailable',
	timestamp: new Date().toISOString(),
	system: { cpu: 0, memory: 0, disk: 0, network: { inbound: 0, outbound: 0 } },
	services: [],
}

const usageSummary = (totalDeployments: number) => ({
	totalDeployments,
	successRate: totalDeployments === 0 ? 0 : 92,
	averageDeployTime: totalDeployments === 0 ? 0 : 42_000,
	mostActiveProjects: totalDeployments === 0 ? [] : [{ projectId: 'p-1', projectName: 'Storefront', deploymentCount: totalDeployments }],
})

export const platformFixtures: FixtureMap = {
	useDeploymentMetrics: {
		empty: { data: [], dataSource: 'docker' },
		populated: { data: [{ timestamp: minutesAgo(60), deploymentsCount: 3, rollbackCount: 1 }, { timestamp: minutesAgo(0), deploymentsCount: 2, rollbackCount: 0 }], dataSource: 'docker' },
	},
	useServiceHealth: {
		empty: { data: [], dataSource: 'docker' },
		populated: { data: [{ serviceName: 'api', status: 'healthy', uptime: 99.9 }, { serviceName: 'worker', status: 'unhealthy', uptime: 80 }], dataSource: 'docker' },
	},
	useDeploymentUsage: { empty: { summary: usageSummary(0) }, populated: { summary: usageSummary(5) } },
	useClusterNodes: { empty: [], populated: clusterNodes },
	useClusterSnapshot: { empty: { ...clusterSnapshot, nodeCount: 0, managerCount: 0, localNodeState: 'inactive', controlAvailable: false, master: null }, populated: clusterSnapshot },
	useIngress: { empty: emptyIngress, populated: populatedIngress },
	useGetPublicIp: { empty: { ip: null }, populated: { ip: '203.0.113.7' } },
	useNodeNetworkConfig: { empty: { publicAddress: null }, populated: { publicAddress: null } },
	usePublicAccessPointLive: {
		empty: undefined,
		raw: () => ({ state: null, stream: {}, snapshot: {}, isLoading: false }),
	},
	useListNodeNetworkConfigs: { empty: { configs: [] }, populated: { configs: [] } },
	useRealTimeMetrics: { empty: emptyMetrics, populated: { ...emptyMetrics, dataSource: 'docker', system: { cpu: 12, memory: 40, disk: 20, network: { inbound: 1, outbound: 1 } } } },
}
