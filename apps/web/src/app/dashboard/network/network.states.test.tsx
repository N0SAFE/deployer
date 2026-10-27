import '@/test-support/mocks'
import { describePageStates } from '@/test-support'
import { emptyIngress } from '@/test-support/fixtures/platform'
import NetworkOverviewPage from './page'
import NetworkIngressPage from './ingress/page'
import NetworkMeshPage from './mesh/page'
import NetworkDnsPage from './dns/page'
import NetworkDomainsPage from './domains/page'

describePageStates('Network overview', {
	page: () => <NetworkOverviewPage />,
	empty: { action: /ingress|mesh|enable|open|set up|configure/i },
})

describePageStates('Network ingress & edge', {
	page: () => <NetworkIngressPage />,
	empty: { action: /turn on|enable|set up|configure|add|choose/i },
	adminOnly: /enable|save|set up|choose|apply|change|tear/i,
})

describePageStates('Network mesh', {
	page: () => <NetworkMeshPage />,
	empty: { action: /settings|join|connect|add|invite/i },
	variants: [
		{
			name: 'mesh agent unreachable',
			hooks: {},
			data: { useIngress: { ...emptyIngress, mesh: { ...emptyIngress.mesh, available: false, lastError: 'socket closed' } } },
			expect: 'error',
		},
	],
	adminOnly: /revoke|remove/i,
})

describePageStates('Network DNS', {
	page: () => <NetworkDnsPage />,
	empty: { action: /provider|configure|connect|add/i },
})

describePageStates('Network domains', {
	page: () => <NetworkDomainsPage />,
	empty: { action: /create.*project|new project/i },
	variants: [
		{ name: 'projects exist, no domains', hooks: { useProjectDomains: 'empty' }, expect: 'empty', empty: { action: /add domain/i } },
		{ name: 'projects exist, domains query fails', hooks: { useProjectDomains: 'error' }, expect: 'error' },
		{ name: 'projects exist, domains loading', hooks: { useProjectDomains: 'loading' }, expect: 'loading' },
	],
})
