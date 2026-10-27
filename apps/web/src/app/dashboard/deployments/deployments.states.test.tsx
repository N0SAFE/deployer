import '@/test-support/mocks'
import { describePageStates } from '@/test-support'
import DashboardDeploymentsPage from './page'

describePageStates('Deployments list', {
	page: () => <DashboardDeploymentsPage />,
	empty: { action: /create|project|deploy|service/i },
})
