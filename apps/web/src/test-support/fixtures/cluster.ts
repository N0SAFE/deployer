import { minutesAgo, type FixtureMap } from './types'

export const swarmService = (over: Record<string, unknown> = {}) => ({
	id: 'svc-1',
	name: 'deployer_api',
	versionIndex: 1,
	image: 'deployer/api:3.0.0',
	labels: {},
	replicas: 2,
	networks: [],
	updateStatus: null,
	createdAt: minutesAgo(600),
	updatedAt: minutesAgo(10),
	mode: 'replicated',
	desiredTasks: 2,
	runningTasks: 2,
	...over,
})

export const swarmTask = (over: Record<string, unknown> = {}) => ({
	id: 'task-1',
	serviceId: 'svc-1',
	serviceName: 'deployer_api',
	nodeId: 'node-1',
	slot: 1,
	state: 'running',
	desiredState: 'running',
	error: null,
	containerId: 'c-1',
	image: 'deployer/api:3.0.0',
	updatedAt: minutesAgo(5),
	...over,
})

export const swarmConfigView = {
	participation: { mode: 'create', policy: 'auto', advertiseAddr: null, joinToken: null, joinAddrs: [] },
	setupDone: true,
	engineState: 'active',
	role: 'manager',
	availability: 'active',
	nodeCount: 3,
	managerCount: 1,
	joinTokens: null,
	resolveNote: 'This node founded the swarm.',
	policies: [
		{ policy: 'auto', name: 'Automatic', description: 'The cluster decides.', bestFor: 'Most installs', role: 'manager', schedulesWorkloads: true, recommended: true },
		{ policy: 'manager', name: 'Manager', description: 'Always a manager.', bestFor: 'Small clusters', role: 'manager', schedulesWorkloads: true, recommended: false },
		{ policy: 'worker', name: 'Worker', description: 'Never a manager.', bestFor: 'Large clusters', role: 'worker', schedulesWorkloads: true, recommended: false },
	],
}

export const clusterFixtures: FixtureMap = {
	useClusterMaster: { empty: undefined, populated: { nodeId: 'node-1', state: 'active', term: 1 } },
	useClusterServices: { empty: [], populated: [swarmService(), swarmService({ id: 'svc-2', name: 'traefik', mode: 'global', replicas: null, desiredTasks: 3, runningTasks: 3 })] },
	useClusterTasks: { empty: [], populated: [swarmTask(), swarmTask({ id: 'task-2', slot: 2, state: 'failed', error: 'no suitable node' })] },
	useSwarmConfig: { empty: swarmConfigView, populated: swarmConfigView },
	useNodeResources: { empty: undefined },
}
