import '@/test-support/mocks'
import { describePageStates } from '@/test-support'
import { DashboardOverviewClient } from './dashboard-client'

describePageStates('Dashboard command center', {
	page: () => <DashboardOverviewClient operatorName="Test Operator" />,
	empty: { action: /add|connect|deploy|create|join|go to nodes/i },
})
