'use client'

import { Globe, LayoutGrid, Network, Route as RouteIcon, Waypoints } from 'lucide-react'
import { SectionNav, type SectionNavItem } from '@/components/dashboard'
import {
  AuthDashboardNetwork,
  AuthDashboardNetworkDns,
  AuthDashboardNetworkDomains,
  AuthDashboardNetworkIngress,
  AuthDashboardNetworkMesh,
} from '@/routes'

/**
 * Ordered the way traffic flows: how clients reach the stack (Ingress & edge),
 * how nodes reach each other (Mesh), where names point (DNS), and the domains
 * deployments publish on top of all three.
 */
const ITEMS: readonly SectionNavItem[] = [
  { title: 'Overview', route: AuthDashboardNetwork, icon: LayoutGrid, exact: true },
  { title: 'Ingress & edge', route: AuthDashboardNetworkIngress, icon: RouteIcon },
  { title: 'Mesh', route: AuthDashboardNetworkMesh, icon: Waypoints },
  { title: 'DNS', route: AuthDashboardNetworkDns, icon: Network },
  { title: 'Domains', route: AuthDashboardNetworkDomains, icon: Globe },
]

export function NetworkNav() {
  return <SectionNav label="Network sections" items={ITEMS} />
}
