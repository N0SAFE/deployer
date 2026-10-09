'use client'

import { Activity, Cpu, LayoutGrid } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { SectionNav, type SectionNavItem } from '@/components/dashboard'
import { useFleetAdmissionRequests } from '@/domains/fleet/hooks'
import { useHydrated } from '@/lib/use-hydrated'
import { AuthDashboardNodes, AuthDashboardNodesCapacity, AuthDashboardNodesDiagnostics } from '@/routes'

/**
 * Count of admission requests waiting for a decision.
 *
 * Nothing is drawn for `undefined` or 0: an unloaded count must not read as
 * "none", and a zero badge is noise on every tab of a quiet install.
 */
function PendingBadge({ value }: { value: number | undefined }) {
  if (value === undefined || value === 0) return null
  return (
    <span
      className="rounded-full bg-status-pending/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-status-pending"
      aria-label={`${String(value)} awaiting a decision`}
    >
      {value}
    </span>
  )
}

/**
 * Tab strip of the Nodes section. It only appears on the three section pages:
 * a node's own workspace (`/nodes/[nodeId]`) lives under the same layout but has
 * its own header and must not grow section tabs.
 */
export function NodesNav() {
  const pathname = usePathname()
  const hydrated = useHydrated()
  const { data: pendingData } = useFleetAdmissionRequests({ status: 'pending' })

  const sectionUrls: readonly string[] = [
    AuthDashboardNodes(),
    AuthDashboardNodesCapacity(),
    AuthDashboardNodesDiagnostics(),
  ]
  const normalised = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (!sectionUrls.includes(normalised)) return null

  const items: readonly SectionNavItem[] = [
    { title: 'Overview', route: AuthDashboardNodes, icon: LayoutGrid, exact: true },
    {
      title: 'Capacity & admissions',
      route: AuthDashboardNodesCapacity,
      icon: Cpu,
      badge: <PendingBadge value={hydrated ? pendingData?.items.length : undefined} />,
    },
    { title: 'Diagnostics', route: AuthDashboardNodesDiagnostics, icon: Activity },
  ]
  return <SectionNav label="Nodes sections" items={items} />
}
