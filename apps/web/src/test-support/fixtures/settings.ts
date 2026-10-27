import { ERROR_MESSAGE, refetchSpy, type Scenario } from '../scenario'
import { daysAgo, minutesAgo, type FixtureMap } from './types'

const adminUser = (over: Record<string, unknown> = {}) => ({
	id: 'user-1',
	name: 'Test Operator',
	email: 'operator@example.test',
	emailVerified: true,
	role: 'admin',
	banned: false,
	banReason: null,
	banExpires: null,
	image: null,
	createdAt: daysAgo(30),
	updatedAt: daysAgo(1),
	...over,
})

/** `useAdminActions()` bundles six mutations; the page only calls the `mutate` side. */
const adminActions = () => ({
	banUser: () => undefined,
	banUserAsync: () => Promise.resolve({}),
	unbanUser: () => undefined,
	unbanUserAsync: () => Promise.resolve({}),
	setRole: () => undefined,
	setRoleAsync: () => Promise.resolve({}),
	createUser: () => undefined,
	createUserAsync: () => Promise.resolve({}),
	updateUser: () => undefined,
	updateUserAsync: () => Promise.resolve({}),
	removeUser: () => undefined,
	removeUserAsync: () => Promise.resolve({}),
	isLoading: { ban: false, unban: false, setRole: false, create: false, update: false, remove: false },
	errors: { ban: null, unban: null, setRole: null, create: null, update: null, remove: null },
})

/** Account hooks return `{ data, error, isLoading, reload }`, not a query. */
function accountResource(name: string, empty: unknown, populated: unknown) {
	return (state: Scenario) => {
		const spy = refetchSpy(name)
		const reload = () => {
			spy()
			return Promise.resolve()
		}
		switch (state) {
			case 'loading':
				return { data: null, error: null, isLoading: true, reload }
			case 'error':
				return { data: null, error: ERROR_MESSAGE, isLoading: false, reload }
			case 'empty':
				return { data: empty, error: null, isLoading: false, reload }
			case 'populated':
				return { data: populated, error: null, isLoading: false, reload }
		}
	}
}

const readiness = {
	ready: true,
	strictEnforced: false,
	converged: true,
	ackRatio: 1,
	receivedAcks: 3,
	expectedAcks: 3,
	minAckRatio: 0.8,
	maxAckAgeSeconds: 12,
	lastRotationAgeSeconds: 600,
	reasons: [],
	rollbackTriggers: [],
	rollbackRecommended: false,
}

const keyring = { activeKeyId: 'key-2026-10', keys: [{ keyId: 'key-2026-10', algorithm: 'hmac-sha256', status: 'active' }, { keyId: 'key-2026-04', algorithm: 'hmac-sha256', status: 'retired' }] }

export const settingsFixtures: FixtureMap = {
	useAdminListUsers: {
		empty: { users: [], total: 0 },
		populated: { users: [adminUser(), adminUser({ id: 'user-2', name: 'Pat Viewer', email: 'pat@example.test', role: 'viewer' }), adminUser({ id: 'user-3', name: 'Banned Bob', email: 'bob@example.test', banned: true, banReason: 'spam' })], total: 3 },
	},
	useAdminActions: { empty: undefined, raw: adminActions },
	useGitHubApps: { empty: { apps: [] }, populated: { apps: [] } },
	useGitlabApps: { empty: { apps: [] }, populated: { apps: [] } },
	useDNSProviders: { empty: { providers: [] }, populated: { providers: [{ id: 'dns-1', providerType: 'cloudflare', name: 'Main account', isActive: true, state: { status: 'ok', accountId: 'abcdef0123456789', error: null } }] } },
	useMeshTrustStrictReadiness: { empty: readiness, populated: readiness },
	useMeshTrustKeyringStatus: { empty: { activeKeyId: null, keys: [] }, populated: keyring },
	useMeshTrustKeyringSecrets: { empty: { keys: [] }, populated: { keys: keyring.keys.map((k) => ({ ...k, secretMaterial: 'secret' })) } },
	useMeshTrustKeyringConvergenceStatus: { empty: { converged: true, receivedAcks: 0, expectedAcks: 0, pendingNodeIds: [], lastRotatedAt: null }, populated: { converged: true, receivedAcks: 3, expectedAcks: 3, pendingNodeIds: [], lastRotatedAt: minutesAgo(600) } },
	useNodeStatus: { empty: { isConfigured: true, nodeId: 'node-1', strategy: 'local', meshUrlsSnapshot: [], configuredAt: minutesAgo(600) }, populated: { isConfigured: true, nodeId: 'node-1', strategy: 'local', meshUrlsSnapshot: [], configuredAt: minutesAgo(600) } },
	usePasskeys: { empty: undefined, raw: accountResource('usePasskeys', [], [{ id: 'pk-1', name: 'Laptop', createdAt: daysAgo(3), deviceType: 'multiDevice', backedUp: true }]) },
	useActiveSessions: { empty: undefined, raw: accountResource('useActiveSessions', [], [{ id: 's-1', token: 't-1', ipAddress: '10.0.0.2', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0', createdAt: daysAgo(1), expiresAt: daysAgo(-6) }]) },
	useApiKeys: { empty: undefined, raw: accountResource('useApiKeys', [], [{ id: 'k-1', name: 'CI', start: 'dpl_', enabled: true, expiresAt: null, lastRequest: null, remaining: null, requestCount: 0 }]) },
	useLinkedAccounts: { empty: undefined, raw: accountResource('useLinkedAccounts', [], []) },
	useAgents: { empty: undefined, raw: accountResource('useAgents', [], []) },
	useAgentHosts: { empty: undefined, raw: accountResource('useAgentHosts', [], []) },
	useTwoFactor: { empty: undefined, raw: () => ({ backupCodes: [], isBusy: false, error: null, enable: () => Promise.resolve(), disable: () => Promise.resolve(), regenerateBackupCodes: () => Promise.resolve(), clearBackupCodes: () => undefined }) },
}
