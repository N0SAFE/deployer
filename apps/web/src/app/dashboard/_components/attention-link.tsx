'use client'

import type { ReactNode } from 'react'
import {
	AuthDashboardCluster,
	AuthDashboardDeployments,
	AuthDashboardNetworkIngress,
	AuthDashboardNetworkMesh,
	AuthDashboardNodes,
	AuthDashboardNodesCapacity,
	AuthDashboardProjectsProjectIdServicesServiceIdDeployments,
	DashboardAnalytics,
} from '@/routes'
import type { AttentionItem } from '../_utils/platform-verdict'

const cls = 'text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring'

/** Renders the typed link an attention item points at. */
export function AttentionLink({ item, children }: { item: AttentionItem; children: ReactNode }) {
	switch (item.target) {
		case 'cluster': return <AuthDashboardCluster.Link className={cls}>{children}</AuthDashboardCluster.Link>
		case 'nodes': return <AuthDashboardNodes.Link className={cls}>{children}</AuthDashboardNodes.Link>
		case 'nodes-capacity': return <AuthDashboardNodesCapacity.Link className={cls}>{children}</AuthDashboardNodesCapacity.Link>
		case 'network-mesh': return <AuthDashboardNetworkMesh.Link className={cls}>{children}</AuthDashboardNetworkMesh.Link>
		case 'network-ingress': return <AuthDashboardNetworkIngress.Link className={cls}>{children}</AuthDashboardNetworkIngress.Link>
		case 'analytics': return <DashboardAnalytics.Link className={cls}>{children}</DashboardAnalytics.Link>
		case 'deployment':
			return item.projectId !== undefined && item.serviceId !== undefined ? (
				<AuthDashboardProjectsProjectIdServicesServiceIdDeployments.Link projectId={item.projectId} serviceId={item.serviceId} className={cls}>
					{children}
				</AuthDashboardProjectsProjectIdServicesServiceIdDeployments.Link>
			) : (
				<AuthDashboardDeployments.Link className={cls}>{children}</AuthDashboardDeployments.Link>
			)
	}
}
