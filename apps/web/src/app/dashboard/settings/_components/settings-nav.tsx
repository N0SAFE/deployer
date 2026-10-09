'use client'

import { LayoutGrid, Plug, Server, ShieldCheck, User, Users } from 'lucide-react'
import { SectionNav, type SectionNavItem } from '@/components/dashboard'
import {
  AuthDashboardAdminProviders,
  AuthDashboardSettings,
  AuthDashboardSettingsAccount,
  AuthDashboardSettingsNode,
  AuthDashboardSettingsSecurity,
  AuthDashboardSettingsUsers,
} from '@/routes'
import { useIsPlatformAdmin } from './use-is-admin'

/**
 * Personal settings first, then the platform-wide ones. Integrations links OUT to
 * the provider pages: they keep their URLs because GitHub callback URLs are
 * registered externally, so that tab leaves this section's layout.
 */
export function SettingsNav() {
  const isAdmin = useIsPlatformAdmin()
  const items: readonly SectionNavItem[] = [
    { title: 'Overview', route: AuthDashboardSettings, icon: LayoutGrid, exact: true },
    { title: 'Account', route: AuthDashboardSettingsAccount, icon: User },
    { title: 'Users & access', route: AuthDashboardSettingsUsers, icon: Users, visible: isAdmin },
    { title: 'Integrations', route: AuthDashboardAdminProviders, icon: Plug },
    { title: 'This node', route: AuthDashboardSettingsNode, icon: Server, visible: isAdmin },
    { title: 'Security', route: AuthDashboardSettingsSecurity, icon: ShieldCheck, visible: isAdmin },
  ]
  return <SectionNav label="Settings sections" items={items} />
}
