import '@/test-support/mocks'
import { describePageStates } from '@/test-support'
import AnalyticsPage from './page'

describePageStates('Analytics', {
	page: () => <AnalyticsPage />,
	empty: { action: /deploy|project|service|create/i },
})
