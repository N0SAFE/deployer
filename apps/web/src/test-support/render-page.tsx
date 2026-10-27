import type { ReactElement } from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'

/**
 * Render a dashboard page the way the app does, minus the network: inside a
 * throw-away QueryClient (some components read `useQueryClient`) and the nuqs
 * testing adapter (URL-state hooks need one) and nothing else. A render error is NOT swallowed — an uncaught exception fails the test,
 * which is the "no uncaught exception" requirement.
 */
export function renderPage(ui: ReactElement): RenderResult {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	return render(
		<QueryClientProvider client={client}>
			<NuqsTestingAdapter>{ui}</NuqsTestingAdapter>
		</QueryClientProvider>,
	)
}
