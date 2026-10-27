'use client'

import { useQuery } from '@tanstack/react-query'

import type { TimeRange } from '@/domains/analytics/types'

import { bffEndpoints } from './endpoints'

/**
 * Hooks for the BFF's screen procedures.
 *
 * A screen that needs a JOIN calls these; a screen that needs a RESOURCE calls
 * the owning service's domain. The landing page is the first adopter: it used to
 * make six separate reads (cluster nodes, cluster snapshot, fleet admissions,
 * deployments, services, ingress, metrics) and join them in the browser, which
 * meant the browser had to know which service owns which fact.
 */
export function useDashboardOverview() {
	return useQuery(bffEndpoints.dashboardOverview.queryOptions())
}

export function useProjectOverviews(input?: { limit?: number; offset?: number }) {
	return useQuery(
		bffEndpoints.listProjectOverviews.queryOptions({ input: { query: input ?? {} } }),
	)
}

export function useBffProjectDetail(projectId: string) {
	return useQuery({
		...bffEndpoints.projectDetail.queryOptions({ input: { params: { projectId } } }),
		enabled: projectId.length > 0,
	})
}

export function useBffServiceDetail(serviceId: string) {
	return useQuery({
		...bffEndpoints.serviceDetail.queryOptions({ input: { params: { serviceId } } }),
		enabled: serviceId.length > 0,
	})
}

export function useAnalyticsOverview(timeRange: TimeRange) {
	return useQuery(
		bffEndpoints.analyticsOverview.queryOptions({ input: { query: { timeRange } } }),
	)
}

export function useAccountOverview() {
	return useQuery(bffEndpoints.accountOverview.queryOptions())
}

export function useBffFleetOverview() {
	return useQuery(bffEndpoints.fleetOverview.queryOptions())
}
