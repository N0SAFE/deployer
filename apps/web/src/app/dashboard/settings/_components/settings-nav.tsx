'use client'

import { KeyRound, LayoutGrid, Plug, Server, User, Users } from 'lucide-react'

import { SectionNav, type SectionNavItem } from '@/components/dashboard'
import { useCan } from '@/lib/access/permissions'
import {
    AuthDashboardAdminProviders,
    AuthDashboardSettings,
    AuthDashboardSettingsAccount,
    AuthDashboardSettingsNode,
    AuthDashboardSettingsSecrets,
    AuthDashboardSettingsUsers,
} from '@/routes'

/**
 * Personal settings first, then the platform-wide ones. Integrations links OUT to
 * the provider pages: they keep their URLs because GitHub callback URLs are
 * registered externally, so that tab leaves this section's layout.
 */
export function SettingsNav() {
    // `settings:manage` is what the users/node areas need; it is the catalog's name for "platform admin", so the nav
    // cannot disagree with the API about who may open them.
    const canManageSettings = useCan('settings:manage')
    const canReadSecrets = useCan('platform.secret:read')
    const items: readonly SectionNavItem[] = [
        {
            title: 'Overview',
            route: AuthDashboardSettings,
            icon: LayoutGrid,
            exact: true,
        },
        { title: 'Account', route: AuthDashboardSettingsAccount, icon: User },
        {
            title: 'Users & access',
            route: AuthDashboardSettingsUsers,
            icon: Users,
            visible: canManageSettings,
        },
        {
            title: 'Integrations',
            route: AuthDashboardAdminProviders,
            icon: Plug,
        },
        {
            title: 'This node',
            route: AuthDashboardSettingsNode,
            icon: Server,
            visible: canManageSettings,
        },
        {
            title: 'Secrets',
            route: AuthDashboardSettingsSecrets,
            icon: KeyRound,
            visible: canReadSecrets,
        },
    ]
    return <SectionNav label="Settings sections" items={items} />
}
