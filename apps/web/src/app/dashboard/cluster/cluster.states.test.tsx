import '@/test-support/mocks'
import { describePageStates } from '@/test-support'
import DashboardClusterPage from './page'

describePageStates('Cluster', {
	page: () => <DashboardClusterPage />,
	empty: { action: /add|join|connect|node|swarm/i },
})
