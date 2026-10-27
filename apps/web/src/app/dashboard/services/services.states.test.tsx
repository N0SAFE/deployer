import '@/test-support/mocks'
import { describePageStates } from '@/test-support'
import DashboardServicesPage from './page'

describePageStates('Services list', {
	page: () => <DashboardServicesPage />,
	empty: { action: /create|project|add|new/i },
})
