import { expect } from 'vitest'

import '@/test-support/mocks'
import { asComponent, describePageStates, sessionFor } from '@/test-support'

import SettingsAccountPage from './account/page'
import SettingsNodePage from './node/page'
import SettingsPage from './page'
import SettingsUsersPage from './users/page'

describePageStates('Settings hub', {
	page: () => <SettingsPage />,
	skipLoading: 'static navigation page: it renders at once; only secondary status lines wait on data',
	skipError: 'static navigation page: a failed status query must only drop its status line',
	checks: {
		error: (container) => {
			expect(container.textContent, 'a failed integrations query must not be shown as "0 of N connected"').not.toMatch(/\d+ of \d+ connected/)
			expect(container.textContent, 'a failed readiness query must not be shown as "Strict mode is off"').not.toMatch(/Strict mode is (on|off)/)
		},
	},
	empty: { action: /open|go to|connect|account/i },
	adminOnly: /users & access|this node/i,
})

describePageStates('Settings account', {
	page: () => {
		const Page = asComponent<{ session: unknown }>(SettingsAccountPage)
		return <Page session={sessionFor('admin').data} />
	},
	empty: { action: /add|create|save|enable|register/i },
})

describePageStates('Settings users & access', {
	page: () => <SettingsUsersPage />,
	skipEmpty: 'an empty user list cannot occur: the signed-in admin is always a user; the table only runs out of rows by paging past the end',
})

describePageStates('Settings this node', {
	page: () => <SettingsNodePage />,
	empty: { action: /edit|save|test|regenerate/i },
	adminOnly: /edit config|regenerate|test connection/i,
})
