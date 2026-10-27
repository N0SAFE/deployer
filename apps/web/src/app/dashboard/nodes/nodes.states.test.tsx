import '@/test-support/mocks'
import { describePageStates } from '@/test-support'
import { NODE_A } from '@/test-support/fixtures/fleet'
import DashboardNodesPage from './page'
import NodesCapacityPage from './capacity/page'
import NodesDiagnosticsPage from './diagnostics/page'
import DashboardNodeDetailPage from './[nodeId]/page'

describePageStates('Nodes list', {
	page: () => <DashboardNodesPage />,
	empty: { action: /add|connect|join|node/i },
})

describePageStates('Nodes capacity & admissions', {
	page: () => <NodesCapacityPage />,
	empty: { action: /add|reserve|allocate|create|node/i },
})

describePageStates('Nodes diagnostics', {
	page: () => <NodesDiagnosticsPage />,
	empty: { action: /connect|plan|look/i },
	retryIsNotRefetch: true,
})

describePageStates('Node detail', {
	page: () => <DashboardNodeDetailPage />,
	params: { nodeId: NODE_A },
	empty: { action: /all nodes/i },
})
