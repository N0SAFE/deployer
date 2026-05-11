'use client'

import { 
  Building2, 
  ChevronRight,
  Users, 
  Settings, 
  Server,
  Container,
  FolderKanban,
  Rocket,
  Home, 
  Shield, 
  UserCircle,
  LayoutDashboard,
  ChevronUp,
  LogOut,
} from 'lucide-react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Home as HomeRoute } from '@/routes'
import { useSession, signOut } from '@/lib/auth'
import { revalidateAllAction } from '@/components/signout/revalidateAll.action'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarSeparator,
} from '@repo/ui/components/shadcn/sidebar'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@repo/ui/components/shadcn/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@repo/ui/components/shadcn/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@repo/ui/components/shadcn/avatar'

interface NavItem {
  title: string
  url: string
  icon: React.ElementType
  exact?: boolean
  items?: Array<{ title: string; url: string }>
}

const mainNavItems: NavItem[] = [
  { 
    title: 'Overview', 
    url: '/dashboard',
    icon: LayoutDashboard,
    exact: true,
  },
  { 
    title: 'Projects',
    url: '/dashboard/projects',
    icon: FolderKanban,
  },
  {
    title: 'Deployments',
    url: '/dashboard/deployments',
    icon: Rocket,
  },
  {
    title: 'Services',
    url: '/dashboard/services',
    icon: Server,
  },
  {
    title: 'Docker',
    url: '/dashboard/docker',
    icon: Container,
    items: [
      { title: 'Overview', url: '/dashboard/docker' },
      { title: 'Containers', url: '/dashboard/docker/containers' },
      { title: 'Logs', url: '/dashboard/docker/logs' },
      { title: 'Shell', url: '/dashboard/docker/shell' },
      { title: 'Stacks', url: '/dashboard/docker/stacks' },
      { title: 'Images', url: '/dashboard/docker/images' },
      { title: 'Volumes', url: '/dashboard/docker/volumes' },
      { title: 'Networks', url: '/dashboard/docker/networks' },
      { title: 'Registry', url: '/dashboard/docker/registry' },
      { title: 'Activity', url: '/dashboard/docker/activity' },
    ],
  },
  {
    title: 'Organizations', 
    url: '/dashboard/admin/organizations',
    icon: Building2,
  },
]

const adminNavItems: NavItem[] = [
  { 
    title: 'Servers', 
    url: '/dashboard/admin/servers',
    icon: Server,
  },
  { 
    title: 'Users', 
    url: '/dashboard/admin/users',
    icon: Users,
  },
  { 
    title: 'Organizations', 
    url: '/dashboard/admin/organizations',
    icon: Building2,
  },
  { 
    title: 'System', 
    url: '/dashboard/admin/system',
    icon: Settings,
  },
]

const accountNavItems: NavItem[] = [
  { 
    title: 'Profile', 
    url: '/dashboard/profile',
    icon: UserCircle,
  },
]

function getInitials(name: string | undefined): string {
  if (!name) return 'U'
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function DashboardSidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  
  // Check if user has admin role
  const isAdmin = session?.user.role === 'admin' || session?.user.role === 'superAdmin'

  const isActive = (item: Pick<NavItem, 'url' | 'exact'>) => {
    if (item.exact) {
      return pathname === item.url
    }
    return pathname.startsWith(item.url)
  }

  const hasActiveChild = (item: NavItem) => {
    return item.items?.some((subItem) => pathname.startsWith(subItem.url)) ?? false
  }

  const handleSignOut = async () => {
    await signOut()
    void revalidateAllAction()
    // Force redirect to home page after signout
    window.location.href = '/'
  }

  return (
    <Sidebar collapsible="icon">
      {/* Header */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <HomeRoute.Link>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Home className="size-4" />
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold">Deployer v3</span>
                  <span className="text-xs text-muted-foreground">Platform Console</span>
                </div>
              </HomeRoute.Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* Main Navigation */}
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNavItems.map((item) => (
                <Collapsible
                  key={item.title}
                  asChild
                  defaultOpen={isActive(item) || hasActiveChild(item)}
                  className="group/collapsible"
                >
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={isActive(item)} tooltip={item.title}>
                      <Link href={item.url}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                    {item.items?.length ? (
                      <>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuAction className="group-data-[state=open]/collapsible:rotate-90">
                            <ChevronRight />
                            <span className="sr-only">Toggle</span>
                          </SidebarMenuAction>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {item.items.map((subItem) => (
                              <SidebarMenuSubItem key={subItem.title}>
                                <SidebarMenuSubButton asChild isActive={pathname === subItem.url || pathname.startsWith(`${subItem.url}/`)}>
                                  <Link href={subItem.url}>
                                    <span>{subItem.title}</span>
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            ))}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </>
                    ) : null}
                  </SidebarMenuItem>
                </Collapsible>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Admin Section - Only shown for admins */}
        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>
              <Shield className="size-3 mr-1" />
              Admin Panel
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminNavItems.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={isActive(item)} tooltip={item.title}>
                      <Link href={item.url}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Account Section */}
        <SidebarGroup>
          <SidebarGroupLabel>Account</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {accountNavItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={isActive(item)} tooltip={item.title}>
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />

      {/* User Footer */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarImage src={session?.user.image ?? undefined} alt={session?.user.name ?? 'User'} />
                    <AvatarFallback className="rounded-lg">
                      {getInitials(session?.user.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">
                      {session?.user.name ?? 'User'}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {session?.user.email ?? ''}
                    </span>
                  </div>
                  <ChevronUp className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                side="top"
                align="start"
                sideOffset={4}
              >
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <Avatar className="h-8 w-8 rounded-lg">
                      <AvatarImage src={session?.user.image ?? undefined} alt={session?.user.name ?? 'User'} />
                      <AvatarFallback className="rounded-lg">
                        {getInitials(session?.user.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">
                        {session?.user.name ?? 'User'}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {session?.user.email ?? ''}
                      </span>
                    </div>
                    {isAdmin && (
                      <Shield className="size-4 text-primary" />
                    )}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/profile" className="cursor-pointer">
                    <UserCircle className="mr-2 size-4" />
                    Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void handleSignOut()} className="cursor-pointer text-destructive focus:text-destructive">
                  <LogOut className="mr-2 size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
