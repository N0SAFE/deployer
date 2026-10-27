import '@/test-support/mocks'
import { describePageStates } from '@/test-support'
import IntegrationsPage from './page'

describePageStates('Admin providers hub', {
	page: () => <IntegrationsPage />,
	empty: { action: /connect/i },
})
