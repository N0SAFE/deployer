"use client";

import { QueryClient } from "@tanstack/react-query";

/**
 * React Query client for the setup wizard.
 *
 * The wizard is rendered from several entry paths (the API's SSR view, the web
 * app's own /setup page), and a missing React Query context is fatal at render
 * time ("No QueryClient set"). The wizard therefore owns its provider
 * internally using this client, so it works the same wherever it is mounted.
 */
export const setupQueryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 30_000,
			refetchOnWindowFocus: false,
			retry: 1,
		},
	},
});

/** Fresh client — for callers that need per-render isolation (SSR). */
export function createSetupQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 30_000,
				refetchOnWindowFocus: false,
				retry: 1,
			},
		},
	});
}
