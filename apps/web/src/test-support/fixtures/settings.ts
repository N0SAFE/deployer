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
	setPassword: () => undefined,
	setPasswordAsync: () => Promise.resolve({}),
	isLoading: { ban: false, unban: false, setRole: false, create: false, update: false, remove: false, impersonate: false, setPassword: false },
	errors: { ban: null, unban: null, setRole: null, create: null, update: null, remove: null, impersonate: null, setPassword: null },
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

export const settingsFixtures: FixtureMap = {
	useAdminListUsers: {
		empty: { users: [], total: 0 },
		populated: { users: [adminUser(), adminUser({ id: 'user-2', name: 'Pat Viewer', email: 'pat@example.test', role: 'viewer' }), adminUser({ id: 'user-3', name: 'Banned Bob', email: 'bob@example.test', banned: true, banReason: 'spam' })], total: 3 },
	},
	useAdminActions: { empty: undefined, raw: adminActions },
	useGitHubApps: { empty: { apps: [] }, populated: { apps: [] } },
	useGitlabApps: { empty: { apps: [] }, populated: { apps: [] } },
	useDNSProviders: { empty: { providers: [] }, populated: { providers: [{ id: 'dns-1', providerType: 'cloudflare', name: 'Main account', isActive: true, state: { status: 'ok', accountId: 'abcdef0123456789', error: null } }] } },
	useNodeStatus: { empty: { isConfigured: true, nodeId: 'node-1', strategy: 'local', meshUrlsSnapshot: [], configuredAt: minutesAgo(600) }, populated: { isConfigured: true, nodeId: 'node-1', strategy: 'local', meshUrlsSnapshot: [], configuredAt: minutesAgo(600) } },
	usePasskeys: { empty: undefined, raw: accountResource('usePasskeys', [], [{ id: 'pk-1', name: 'Laptop', createdAt: daysAgo(3), deviceType: 'multiDevice', backedUp: true }]) },
	useActiveSessions: { empty: undefined, raw: accountResource('useActiveSessions', [], [{ id: 's-1', token: 't-1', ipAddress: '10.0.0.2', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0', createdAt: daysAgo(1), expiresAt: daysAgo(-6) }]) },
	useApiKeys: { empty: undefined, raw: accountResource('useApiKeys', [], [{ id: 'k-1', name: 'CI', start: 'dpl_', enabled: true, expiresAt: null, lastRequest: null, remaining: null, requestCount: 0 }]) },
	useLinkedAccounts: { empty: undefined, raw: accountResource('useLinkedAccounts', [], []) },
	useAgents: { empty: undefined, raw: accountResource('useAgents', [], []) },
	useAgentHosts: { empty: undefined, raw: accountResource('useAgentHosts', [], []) },
	// A mutation hook: `mutate` is fire-and-forget, `mutateAsync` is what the download awaits.
	useExportSelfData: {
		empty: undefined,
		raw: () => ({
			mutate: () => undefined,
			mutateAsync: () =>
				Promise.resolve({
					exportedAt: daysAgo(0),
					user: adminUser(),
					sessions: [],
					apiKeys: [],
				}),
			isPending: false,
			error: null,
		}),
	},
	useManagedRoles: {
		empty: { data: [] },
		populated: {
			data: [
				{ id: 'seeded-superAdmin', name: 'superAdmin', scope: 'platform', rank: 3, label: 'Super Admin', description: null, color: 'red', isSystem: true, permissions: ['role:read'] },
				{ id: 'seeded-admin', name: 'admin', scope: 'platform', rank: 2, label: 'Admin', description: null, color: 'orange', isSystem: true, permissions: ['role:read'] },
				{ id: 'custom-auditor', name: 'auditor', scope: 'platform', rank: 1, label: 'Auditor', description: 'Reads the log', color: null, isSystem: false, permissions: ['audit:read'] },
			],
		},
	},
	useCreateRole: { empty: undefined, raw: () => ({ mutate: () => undefined, mutateAsync: () => Promise.resolve({}), isPending: false, error: null }) },
	useUpdateRole: { empty: undefined, raw: () => ({ mutate: () => undefined, mutateAsync: () => Promise.resolve({}), isPending: false, error: null }) },
	useDeleteRole: { empty: undefined, raw: () => ({ mutate: () => undefined, mutateAsync: () => Promise.resolve({}), isPending: false, error: null }) },
	usePendingApprovals: {
		empty: { data: [] },
		populated: {
			data: [
				{
					id: 'req-1',
					permission: 'user:delete',
					requesterId: 'admin-1',
					requesterName: 'Test Operator',
					via: null,
					scope: {},
					actionHash: 'a'.repeat(64),
					reason: 'remove the duplicate account',
					requiredApprovals: 1,
					status: 'pending',
					ttlSec: 3600,
					expiresAt: minutesAgo(-30),
					consumedAt: null,
					createdAt: minutesAgo(5),
					approvals: 0,
				},
			],
		},
	},
	useRequestApproval: {
		empty: undefined,
		raw: () => ({ mutate: () => undefined, mutateAsync: () => Promise.resolve({}), isPending: false, error: null }),
	},
	useDecideApproval: {
		empty: undefined,
		raw: () => ({ mutate: () => undefined, mutateAsync: () => Promise.resolve({}), isPending: false, error: null }),
	},
	usePlatformRoles: {
		empty: undefined,
		raw: () => ({
			isLoading: false,
			roles: [
				{ id: 'seeded-superAdmin', name: 'superAdmin', scope: 'platform', rank: 3, label: 'Super Admin', description: null, color: 'red', isSystem: true, permissions: [] },
				{ id: 'seeded-admin', name: 'admin', scope: 'platform', rank: 2, label: 'Admin', description: null, color: 'orange', isSystem: true, permissions: [] },
				{ id: 'seeded-operator', name: 'operator', scope: 'platform', rank: 1, label: 'Operator', description: null, color: 'cyan', isSystem: true, permissions: [] },
				{ id: 'seeded-viewer', name: 'viewer', scope: 'platform', rank: 0, label: 'Viewer', description: null, color: 'slate', isSystem: true, permissions: [] },
				{ id: 'seeded-user', name: 'user', scope: 'platform', rank: -1, label: 'User', description: null, color: 'slate', isSystem: true, permissions: [] },
			],
		}),
	},
	useStepUpStatus: {
		empty: undefined,
		raw: accountResource('useStepUpStatus', null, {
			steppedUp: true,
			critical: true,
			method: 'passkey',
			verifiedAt: daysAgo(0),
			expiresAt: minutesAgo(-4),
			windowSeconds: 300,
		}),
	},
	useDeleteSelf: {
		empty: undefined,
		raw: () => ({ mutate: () => undefined, mutateAsync: () => Promise.resolve({ deleted: true }), isPending: false, error: null }),
	},
	useTwoFactor: { empty: undefined, raw: () => ({ backupCodes: [], isBusy: false, error: null, enable: () => Promise.resolve(), disable: () => Promise.resolve(), regenerateBackupCodes: () => Promise.resolve(), clearBackupCodes: () => undefined }) },
}
