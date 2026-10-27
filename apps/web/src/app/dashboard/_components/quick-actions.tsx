'use client'

import { Network, Plus, Server } from 'lucide-react'
import { Button } from '@deployer/ui/components/shadcn/button'
import { AuthDashboardNetwork, AuthDashboardNetworkMesh, AuthDashboardProjects } from '@/routes'

/** Header actions: the three things an operator does from the landing page. */
export function QuickActions() {
	return (
		<>
			<Button asChild size="sm">
				<AuthDashboardProjects.Link><Plus className="mr-1.5 size-4" />New project</AuthDashboardProjects.Link>
			</Button>
			<Button asChild size="sm" variant="outline">
				<AuthDashboardNetworkMesh.Link><Server className="mr-1.5 size-4" />Add a node</AuthDashboardNetworkMesh.Link>
			</Button>
			<Button asChild size="sm" variant="outline">
				<AuthDashboardNetwork.Link><Network className="mr-1.5 size-4" />Network</AuthDashboardNetwork.Link>
			</Button>
		</>
	)
}
