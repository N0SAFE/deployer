'use client'

import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
    useSidebar,
} from '@repo/ui/components/shadcn/sidebar'
import {
    Home,
    FolderOpen,
    Zap,
    Globe,
    Settings,
    User,
    Rocket,
    Building2,
    Users,
    ChevronDown,
    Plus,
    Server,
    BarChart3,
    HardDrive,
    Variable,
    GitBranch,
    Container,
} from 'lucide-react'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@repo/ui/components/shadcn/tooltip'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@repo/ui/components/shadcn/dropdown-menu'
import { Button } from '@repo/ui/components/shadcn/button'
import { Badge } from '@repo/ui/components/shadcn/badge'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
    useActiveOrganization,
    useOrganizations,
    useSetActiveOrganization,
} from '@/hooks/useTeams'
import CreateOrganizationDialog from '@/components/organization/CreateOrganizationDialog'
import { UserProfileFooter } from './UserProfileFooter'
import { Dashboard, DashboardProjects, DashboardContainers, DashboardDomains } from '@/routes'
import { useEffect } from 'react'
import { getDefaultOrganizationId, setDefaultOrganizationId } from '@/lib/organization-state'

const navigationItems = [
    {
        title: 'Dashboard',
        url: Dashboard(),
        icon: Home,
    },
    {
        title: 'Projects',
        url: DashboardProjects(),
        icon: FolderOpen,
    },
    {
        title: 'Deployments',
        url: '/dashboard/deployments',
        icon: Zap,
    },
    {
        title: 'Domains',
        url: DashboardDomains(),
        icon: Globe,
    },
    {
        title: 'Containers',
        url: DashboardContainers(),
        icon: Container,
    },
    {
        title: 'Orchestration',
        url: '/dashboard/orchestration',
        icon: Server,
    },
    {
        title: 'Storage',
        url: '/dashboard/storage',
        icon: HardDrive,
    },
    {
        title: 'Analytics',
        url: '/dashboard/analytics',
        icon: BarChart3,
    },
    {
        title: 'Traefik',
        url: '/dashboard/traefik',
        icon: Globe,
    },
    {
        title: 'Environment',
        url: '/dashboard/environment',
        icon: Variable,
    },
    {
        title: 'CI/CD',
        url: '/dashboard/cicd',
        icon: GitBranch,
    },
] as const

// Account/Settings items to be passed to UserProfileFooter
const accountItems = [
    {
        title: 'Settings',
        url: '/dashboard/settings',
        icon: Settings,
    },
    {
        title: 'User Settings',
        url: '/dashboard/settings/user',
        icon: User,
    },
] as const

type NavigationItem = (typeof navigationItems)[number]

export function AppSidebar() {
    const pathname = usePathname()
    const { state } = useSidebar()

    // Organization data
    const { data: activeOrg } = useActiveOrganization()
    const { data: organizations = [] } = useOrganizations()
    const setActiveOrganization = useSetActiveOrganization()

    // Update cookie when active organization changes
    useEffect(() => {
        if (activeOrg?.id) {
            setDefaultOrganizationId(activeOrg.id)
        }
    }, [activeOrg?.id])

    const getActiveTab = () => {
        let section = navigationItems.find(
            (section) => section.url === pathname
        )
        if (!section) {
            navigationItems.forEach((s) => {
                if (pathname.includes(s.url)) {
                    section = s
                }
            })
        }
        return section
    }

    const renderMenuItem = (
        item: NavigationItem,
        isCollapsed: boolean,
        isFooterItem = false
    ) => (
        <SidebarMenuItem key={item.title}>
            {isCollapsed ? (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <SidebarMenuButton
                                asChild
                                isActive={
                                    pathname === item.url ||
                                    pathname.startsWith(`${item.url}/`)
                                }
                                className={`data-[active=true]:bg-primary/10 data-[active=true]:text-primary hover:bg-accent/50 transition-colors ${
                                    isFooterItem ? 'h-8 text-xs' : ''
                                }`}
                                size={isFooterItem ? 'sm' : 'default'}
                            >
                                <Link href={item.url}>
                                    <item.icon
                                        className={
                                            isFooterItem
                                                ? 'h-3.5 w-3.5'
                                                : 'h-4 w-4'
                                        }
                                    />
                                    <span className="sr-only">
                                        {item.title}
                                    </span>
                                </Link>
                            </SidebarMenuButton>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="font-medium">
                            {item.title}
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            ) : (
                <SidebarMenuButton
                    asChild
                    isActive={getActiveTab()?.url === item.url}
                    className={`data-[active=true]:bg-primary/10 data-[active=true]:text-primary hover:bg-accent/50 transition-colors ${
                        isFooterItem ? 'h-8 text-xs' : ''
                    }`}
                    size={isFooterItem ? 'sm' : 'default'}
                >
                    <Link href={item.url}>
                        <item.icon
                            className={isFooterItem ? 'h-3.5 w-3.5' : 'h-4 w-4'}
                        />
                        <span className={isFooterItem ? 'text-xs' : ''}>
                            {item.title}
                        </span>
                    </Link>
                </SidebarMenuButton>
            )}
        </SidebarMenuItem>
    )

    const isCollapsed = state === 'collapsed'

    return (
        <Sidebar
            variant="floating"
            collapsible="icon"
            className="border-none shadow-lg"
        >
            <SidebarHeader
                className={`border-b border-gray-200 dark:border-gray-800 ${isCollapsed ? 'px-2' : ''}`}
            >
                <div
                    className={`flex items-center gap-2 py-2 ${isCollapsed ? 'justify-center px-0' : 'px-4'}`}
                >
                    <Rocket
                        className={`text-primary ${isCollapsed ? 'h-5 w-5' : 'h-6 w-6'}`}
                    />
                    {!isCollapsed && (
                        <span className="text-lg font-semibold">Deployer</span>
                    )}
                </div>

                {/* Organization Selector */}
                {!isCollapsed && (
                    <div className="px-4 pb-2">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="outline"
                                    className="h-8 w-full justify-between text-xs"
                                >
                                    <div className="flex items-center gap-2">
                                        <Building2 className="h-3.5 w-3.5" />
                                        <span className="truncate">
                                            {activeOrg?.name || organizations[0]?.name || 'Select Organization'}
                                        </span>
                                    </div>
                                    <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-56">
                                <DropdownMenuLabel>
                                    Organizations
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator />

                                {/* Organization list */}
                                {organizations.map(
                                    (org: { id: string; name: string }) => (
                                        <DropdownMenuItem
                                            key={org.id}
                                            onClick={() =>
                                                setActiveOrganization.mutate({
                                                    organizationId: org.id,
                                                })
                                            }
                                            className="flex items-center gap-2"
                                        >
                                            <Building2 className="h-4 w-4" />
                                            <span className="truncate">
                                                {org.name}
                                            </span>
                                            {activeOrg?.id === org.id && (
                                                <Badge
                                                    variant="outline"
                                                    className="ml-auto text-xs"
                                                >
                                                    Current
                                                </Badge>
                                            )}
                                        </DropdownMenuItem>
                                    )
                                )}

                                <DropdownMenuSeparator />
                                <CreateOrganizationDialog>
                                    <DropdownMenuItem
                                        onSelect={(e) => e.preventDefault()}
                                    >
                                        <Plus className="mr-2 h-4 w-4" />
                                        <span>Create Organization</span>
                                    </DropdownMenuItem>
                                </CreateOrganizationDialog>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                )}
            </SidebarHeader>

            <SidebarContent className="flex-1">
                <SidebarGroup>
                    {!isCollapsed && (
                        <SidebarGroupLabel>Navigation</SidebarGroupLabel>
                    )}
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {navigationItems.map((item) =>
                                renderMenuItem(item, isCollapsed)
                            )}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>

                {/* Team Management Section */}
                {activeOrg && !isCollapsed && (
                    <SidebarGroup>
                        <SidebarGroupLabel className="flex items-center justify-between">
                            <span>Team</span>
                            <Users className="h-3.5 w-3.5" />
                        </SidebarGroupLabel>
                        <SidebarGroupContent>
                            <SidebarMenu>
                                <SidebarMenuItem>
                                    <SidebarMenuButton asChild size="sm">
                                        <Link href="/dashboard/team/members">
                                            <Users className="h-3.5 w-3.5" />
                                            <span className="text-xs">
                                                Members
                                            </span>
                                        </Link>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                                <SidebarMenuItem>
                                    <SidebarMenuButton asChild size="sm">
                                        <Link href="/dashboard/team/invitations">
                                            <Plus className="h-3.5 w-3.5" />
                                            <span className="text-xs">
                                                Invitations
                                            </span>
                                        </Link>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                )}
            </SidebarContent>

            <SidebarFooter className="mt-auto border-t border-gray-200 dark:border-gray-800">
                {/* User Profile Section */}
                <UserProfileFooter
                    isCollapsed={isCollapsed}
                    accountItems={accountItems}
                />

                {/* Version Info */}
                {!isCollapsed && (
                    <div className="text-muted-foreground/70 mt-1 border-t border-gray-200/20 px-3 py-2 text-xs dark:border-gray-800/20">
                        <div className="flex items-center justify-between">
                            <span>Deployer</span>
                            <span className="text-muted-foreground/50">
                                v1.0.0
                            </span>
                        </div>
                    </div>
                )}
            </SidebarFooter>

            <SidebarRail />
        </Sidebar>
    )
}
