import { listOf, minutesAgo, daysAgo, type FixtureMap } from './types'

export const PROJECT_ID = '0190b000-0000-7000-8000-000000000001'
export const PROJECT_ID_2 = '0190b000-0000-7000-8000-000000000002'
export const SERVICE_ID = '0190c000-0000-7000-8000-000000000001'
export const SERVICE_ID_2 = '0190c000-0000-7000-8000-000000000002'
export const DEPLOYMENT_ID = '0190d000-0000-7000-8000-000000000001'
export const ENVIRONMENT_ID = '0190e000-0000-7000-8000-000000000001'

export const project = (over: Record<string, unknown> = {}) => ({
	id: PROJECT_ID,
	name: 'Storefront',
	description: 'The customer-facing shop',
	baseDomain: null,
	network: null,
	ownerId: 'user-1',
	settings: null,
	createdAt: daysAgo(10),
	updatedAt: minutesAgo(30),
	_count: { services: 2, deployments: 5, collaborators: 1 },
	latestDeployment: { id: DEPLOYMENT_ID, status: 'success', createdAt: minutesAgo(20) },
	...over,
})

export const service = (over: Record<string, unknown> = {}) => ({
	id: SERVICE_ID,
	projectId: PROJECT_ID,
	name: 'api',
	description: null,
	type: 'application',
	providerId: 'github',
	providerConfig: null,
	builderId: 'orchestrator',
	builderConfig: null,
	port: 3000,
	environmentVariables: null,
	resourceLimits: null,
	healthCheckPath: '/health',
	healthCheckInterval: 30,
	healthCheckTimeout: 5,
	healthCheckRetries: 3,
	deploymentRetention: null,
	traefikConfig: null,
	customDomains: null,
	network: null,
	implementsContract: null,
	preview: null,
	isActive: true,
	metadata: null,
	parentId: null,
	parentPath: null,
	depth: 0,
	createdAt: daysAgo(9),
	updatedAt: minutesAgo(40),
	...over,
})

export const deployment = (over: Record<string, unknown> = {}) => ({
	id: DEPLOYMENT_ID,
	serviceId: SERVICE_ID,
	triggeredBy: 'user-1',
	status: 'success',
	environment: 'production',
	sourceType: 'github',
	sourceConfig: { repositoryUrl: 'https://github.com/acme/api', branch: 'main', commitSha: 'abc1234def' },
	containerName: 'api-1',
	containerImage: 'acme/api:abc1234',
	domainUrl: 'https://api.example.test',
	healthCheckUrl: null,
	errorMessage: null,
	observability: null,
	progress: null,
	connectivityStatus: null,
	buildStartedAt: minutesAgo(25),
	buildCompletedAt: minutesAgo(23),
	deployStartedAt: minutesAgo(22),
	deployCompletedAt: minutesAgo(20),
	metadata: null,
	createdAt: minutesAgo(25),
	updatedAt: minutesAgo(20),
	...over,
})

export const environment = (over: Record<string, unknown> = {}) => ({
	id: ENVIRONMENT_ID,
	projectId: PROJECT_ID,
	name: 'Production',
	slug: 'production',
	description: null,
	kind: 'stable',
	type: 'production',
	status: 'healthy',
	rules: {
		profiles: [],
		autoDeployEnabled: true,
		deploymentStrategy: 'rolling',
		healthGate: 'strict',
		startupMode: 'parallel',
		replicas: { min: 1, max: 1 },
		trafficPolicy: { maxErrorRatePercent: 5, maxLatencyMs: 1000, allowCrossRegionFailover: false },
	},
	trigger: null,
	isActive: true,
	domainConfig: null,
	createdAt: daysAgo(10),
	updatedAt: minutesAgo(60),
	...over,
})

export const projectDomain = (over: Record<string, unknown> = {}) => ({
	id: '0190f000-0000-7000-8000-000000000001',
	projectId: PROJECT_ID,
	domain: 'shop.example.test',
	verificationStatus: 'verified',
	verificationMethod: 'txt_record',
	verificationToken: 'tok_123',
	verifiedAt: minutesAgo(100),
	createdAt: daysAgo(2),
	...over,
})

export const collaborator = (over: Record<string, unknown> = {}) => ({
	id: '0190a100-0000-7000-8000-000000000001',
	projectId: PROJECT_ID,
	userId: 'user-1',
	role: 'owner',
	permissions: null,
	invitedBy: null,
	invitedAt: daysAgo(10),
	acceptedAt: daysAgo(10),
	createdAt: daysAgo(10),
	updatedAt: daysAgo(10),
	...over,
})

export const projectsFixtures: FixtureMap = {
	useProjectList: { empty: listOf([]), populated: listOf([project(), project({ id: PROJECT_ID_2, name: 'Internal tools', description: null, _count: { services: 0, deployments: 0, collaborators: 1 }, latestDeployment: null })]) },
	useProject: { empty: project(), populated: project() },
	useServiceList: { empty: listOf([]), populated: listOf([service(), service({ id: SERVICE_ID_2, name: 'worker', type: 'worker', isActive: false })]) },
	useService: { empty: service(), populated: service() },
	useDeploymentList: {
		empty: listOf([]),
		populated: listOf([deployment(), deployment({ id: '0190d000-0000-7000-8000-000000000002', status: 'failed', errorMessage: 'build failed', createdAt: minutesAgo(90) })]),
	},
	useProjectEnvironments: { empty: { environments: [] }, populated: { environments: [environment(), environment({ id: '0190e000-0000-7000-8000-000000000002', name: 'Staging', slug: 'staging', type: 'staging' })] } },
	useProjectEnvironmentStatus: { empty: { statuses: [] }, populated: { statuses: [{ environmentId: ENVIRONMENT_ID, status: 'healthy' }] } },
	useProjectServiceEnvironmentLinks: { empty: { links: [] }, populated: { links: [{ serviceId: SERVICE_ID, environmentId: ENVIRONMENT_ID, isEnabled: true }] } },
	useProjectVariableTemplates: { empty: { templates: [] }, populated: { templates: [] } },
	useProjectCollaborators: { empty: { collaborators: [] }, populated: { collaborators: [collaborator(), collaborator({ id: '0190a100-0000-7000-8000-000000000002', userId: 'user-2', role: 'developer', acceptedAt: null })] } },
	useProjectDomains: { empty: [], populated: [projectDomain(), projectDomain({ id: '0190f000-0000-7000-8000-000000000002', domain: 'www.example.test', verificationStatus: 'pending', verifiedAt: null })] },
	useCheckDomainGate: { empty: { allowed: true, reason: null }, populated: { allowed: true, reason: null } },
	useServiceDomains: { empty: [], populated: [] },
}
