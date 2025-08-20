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
import { useActiveOrganization, useOrganizations, useSetActiveOrganization } from '@/hooks/useTeams'
import CreateOrganizationDialog from '@/components/organization/CreateOrganizationDialog'
import { UserProfileFooter } from './UserProfileFooter'
import { Dashboard, DashboardProjects } from '@/routes'

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
    title: 'Traefik',
    url: '/dashboard/traefik',
    icon: Globe,
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

type NavigationItem = typeof navigationItems[number]

export function AppSidebar() {
  const pathname = usePathname()
  const { state } = useSidebar()
  
  // Organization data
  const { data: activeOrg } = useActiveOrganization()
  const { data: organizations = [] } = useOrganizations()
  const setActiveOrganization = useSetActiveOrganization()

  const renderMenuItem = (item: NavigationItem, isCollapsed: boolean, isFooterItem = false) => (
    <SidebarMenuItem key={item.title}>
      {isCollapsed ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <SidebarMenuButton
                asChild
                isActive={pathname === item.url || pathname.startsWith(`${item.url}/`)}
                className={`data-[active=true]:bg-primary/10 data-[active=true]:text-primary hover:bg-accent/50 transition-colors ${
                  isFooterItem ? 'h-8 text-xs' : ''
                }`}
                size={isFooterItem ? 'sm' : 'default'}
              >
                <Link href={item.url}>
                  <item.icon className={isFooterItem ? "h-3.5 w-3.5" : "h-4 w-4"} />
                  <span className="sr-only">{item.title}</span>
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
          isActive={pathname === item.url || pathname.startsWith(`${item.url}/`)}
          className={`data-[active=true]:bg-primary/10 data-[active=true]:text-primary hover:bg-accent/50 transition-colors ${
            isFooterItem ? 'h-8 text-xs' : ''
          }`}
          size={isFooterItem ? 'sm' : 'default'}
        >
          <Link href={item.url}>
            <item.icon className={isFooterItem ? "h-3.5 w-3.5" : "h-4 w-4"} />
            <span className={isFooterItem ? "text-xs" : ""}>{item.title}</span>
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
      <SidebarHeader className={`border-b border-border/40 ${isCollapsed ? 'px-2' : ''}`}>
        <div className={`flex items-center gap-2 py-2 ${isCollapsed ? 'justify-center px-0' : 'px-4'}`}>
          <Rocket className={`text-primary ${isCollapsed ? 'h-5 w-5' : 'h-6 w-6'}`} />
          {!isCollapsed && <span className="text-lg font-semibold">Deployer</span>}
        </div>
        
        {/* Organization Selector */}
        {!isCollapsed && (
          <div className="px-4 pb-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-between h-8 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5" />
                    <span className="truncate">
                      {activeOrg?.name || 'Personal'}
                    </span>
                  </div>
                  <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Organizations</DropdownMenuLabel>
                <DropdownMenuSeparator />
                
                {/* Personal workspace */}
                <DropdownMenuItem
                  onClick={() => setActiveOrganization.mutate({ organizationId: null })}
                  className="flex items-center gap-2"
                >
                  <User className="h-4 w-4" />
                  <span>Personal</span>
                  {!activeOrg && <Badge variant="outline" className="ml-auto text-xs">Current</Badge>}
                </DropdownMenuItem>
                
                {/* Organization list */}
                {organizations.map((org) => (
                  <DropdownMenuItem
                    key={org.id}
                    onClick={() => setActiveOrganization.mutate({ organizationId: org.id })}
                    className="flex items-center gap-2"
                  >
                    <Building2 className="h-4 w-4" />
                    <span className="truncate">{org.name}</span>
                    {activeOrg?.id === org.id && (
                      <Badge variant="outline" className="ml-auto text-xs">Current</Badge>
                    )}
                  </DropdownMenuItem>
                ))}
                
                <DropdownMenuSeparator />
                <CreateOrganizationDialog>
                  <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                    <Plus className="h-4 w-4 mr-2" />
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
          {!isCollapsed && <SidebarGroupLabel>Navigation</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {navigationItems.map((item) => renderMenuItem(item, isCollapsed))}
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
                      <span className="text-xs">Members</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild size="sm">
                    <Link href="/dashboard/team/invitations">
                      <Plus className="h-3.5 w-3.5" />
                      <span className="text-xs">Invitations</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-border/40 mt-auto">
        {/* User Profile Section */}
        <UserProfileFooter isCollapsed={isCollapsed} accountItems={accountItems} />
        
        {/* Version Info */}
        {!isCollapsed && (
          <div className="px-3 py-2 mt-1 text-xs text-muted-foreground/70 border-t border-border/20">
            <div className="flex items-center justify-between">
              <span>Deployer</span>
              <span className="text-muted-foreground/50">v1.0.0</span>
            </div>
          </div>
        )}
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}