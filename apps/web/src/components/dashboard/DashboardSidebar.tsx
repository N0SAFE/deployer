'use client'

import { 
  ChevronRight,
  Users, 
  Settings, 
  Server,
  Container,
  Rocket,
  Home, 
  Shield, 
  UserCircle,
  LayoutDashboard,
  ChevronUp,
  LogOut,
  FolderKanban,
  Search,
  GitFork,
  Globe,
  Network,
  Activity,
  SlidersHorizontal,
} from 'lucide-react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import ModeToggle from '@repo/ui/components/shadcn/mode-toggle'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Home as HomeRoute, AuthDashboardProfile, AuthDashboardProjects } from '@/routes'
import { useSession, signOut } from '@/lib/auth'
import { revalidateAllAction } from '@/components/signout/revalidateAll.action'
import { useProjectList } from '@/domains/project/hooks'
import { useServiceList } from '@/domains/service/hooks'
import { openCommandPalette } from './command-palette-store'
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
  items?: { title: string; url: string }[]
}

const mainNavItems: NavItem[] = [
  { 
    title: 'Overview', 
    url: '/dashboard',
    icon: LayoutDashboard,
    exact: true,
  },
  {
    title: 'Analytics',
    url: '/dashboard/analytics',
    icon: Activity,
  },
]

/** Mesh-wide items: projects, services, domains, configuration (span all nodes) */
const meshNavItems: NavItem[] = [
  {
    title: 'Services',
    url: '/dashboard/services',
    icon: Server,
  },
  {
    title: 'Domains',
    url: '/dashboard/admin/domains',
    icon: Globe,
  },
  {
    title: 'Configuration',
    url: '/dashboard/configuration',
    icon: SlidersHorizontal,
  },
]

/** Node-scoped items: nodes, cluster, deployments, docker (per-node scope) */
const nodeNavItems: NavItem[] = [
  {
    title: 'Nodes',
    url: '/dashboard/nodes',
    icon: Network,
  },
  {
    title: 'Cluster',
    url: '/dashboard/cluster',
    icon: Server,
  },
  {
    title: 'Deployments',
    url: '/dashboard/deployments',
    icon: Rocket,
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
]

/** Subtle go-to hints for the primary nav (matched in the command palette). */
const navShortcuts: Record<string, string> = {
  Overview: 'g o',
  Projects: 'g p',
  Deployments: 'g d',
  Services: 'g s',
  Docker: 'g c',
  Nodes: 'g n',
  Profile: 'g u',
  System: 'g a',
}

const adminNavItems: NavItem[] = [
  { 
    title: 'Users', 
    url: '/dashboard/admin/users',
    icon: Users,
  },
  {
    title: 'Providers',
    url: '/dashboard/admin/providers',
    icon: GitFork,
    items: [
      { title: 'Code Providers', url: '/dashboard/admin/providers/code' },
      { title: '▸ GitHub', url: '/dashboard/admin/providers/code/github' },
      { title: '▸ GitLab', url: '/dashboard/admin/providers/code/gitlab' },
      { title: '▸ Docker Hub', url: '/dashboard/admin/providers/code/docker-hub' },
      { title: 'DNS Providers', url: '/dashboard/admin/providers/dns' },
      { title: '▸ Cloudflare', url: '/dashboard/admin/providers/dns/cloudflare' },
      { title: '▸ Route53', url: '/dashboard/admin/providers/dns/route53' },
      { title: '▸ Google DNS', url: '/dashboard/admin/providers/dns/google-dns' },
    ],
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

/** Fuzzy match: returns true if query chars appear in order in text */
function fuzzyMatch(text: string, query: string): boolean {
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < lower.length && qi < q.length; ti++) {
    if (lower[ti] === q[qi]) qi++
  }
  return qi === q.length
}

// ─── Inline Projects Section ──────────────────────────────────────────────

function ProjectsSidebarSection() {
  const pathname = usePathname()
  const [open, setOpen] = useState(() => pathname.startsWith('/dashboard/projects'))
  const [projectFilter, setProjectFilter] = useState('')
  const [expandedProject, setExpandedProject] = useState<string | null>(null)
  const [serviceFilter, setServiceFilter] = useState('')
  const filterInputRef = useRef<HTMLInputElement>(null)

  const { data: projectsData } = useProjectList({ query: { limit: 50, offset: 0 } })

  const projects: { id: string; name: string }[] = useMemo(() => {
    const raw = projectsData as { data?: { id: string; name: string }[] } | undefined
    const list = raw?.data ?? []
    if (!projectFilter) return list
    return list.filter((p: { name: string }) => fuzzyMatch(p.name, projectFilter))
  }, [projectsData, projectFilter])

  // Fetch services when a project is expanded
  const { data: servicesData } = useServiceList({ query: { limit: 50, offset: 0 } })

  // Services of the expanded project — TOP-LEVEL only (sub-services appear
  // inside their parent service's page, never as main nav entries).
  const filteredServices: { id: string; name: string }[] = useMemo(() => {
    const raw = servicesData as { data?: { id: string; name: string; parentId?: string | null; parent_id?: string | null; projectId?: string; project_id?: string }[] } | undefined
    const list = (raw?.data ?? []).filter((s) =>
      (s.projectId === expandedProject || s.project_id === expandedProject) &&
      (s.parentId == null && s.parent_id == null),
    )
    if (!serviceFilter) return list
    return list.filter((s: { name: string }) => fuzzyMatch(s.name, serviceFilter))
  }, [servicesData, serviceFilter, expandedProject])

  const toggleProject = useCallback((projectId: string) => {
    setExpandedProject((prev) => {
      const next = prev === projectId ? null : projectId
      setServiceFilter('')
      return next
    })
  }, [])

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="group/collapsible"
    >
      <SidebarMenuItem>
        <SidebarMenuButton
          asChild
          isActive={pathname.startsWith('/dashboard/projects')}
          tooltip="Projects"
        >
          <AuthDashboardProjects.Link>
            <FolderKanban />
            <span>Projects</span>
          </AuthDashboardProjects.Link>
        </SidebarMenuButton>
        <CollapsibleTrigger asChild>
          <SidebarMenuAction
            className="group-data-[state=open]/collapsible:rotate-90"
            onClick={() => {
              setOpen(!open)
              if (!open) setTimeout(() => filterInputRef.current?.focus(), 100)
            }}
          >
            <ChevronRight />
            <span className="sr-only">Toggle projects</span>
          </SidebarMenuAction>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-1 pt-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={filterInputRef}
                placeholder="Filter projects…"
                value={projectFilter}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setProjectFilter(e.target.value); }}
                className="flex h-7 w-full rounded-md border border-input bg-background px-3 pl-7 text-xs ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </div>
          <SidebarMenuSub>
            {projects.map((project: { id: string; name: string }) => (
              <Collapsible
                key={project.id}
                open={expandedProject === project.id}
                onOpenChange={() => { toggleProject(project.id); }}
                className="group/sub"
              >
                <SidebarMenuSubItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuSubButton
                      asChild
                      isActive={pathname === `/dashboard/projects/${project.id}`}
                      className="cursor-pointer"
                    >
                      <div className="flex w-full items-center justify-between">
                        <span className="flex-1 truncate">{project.name}</span>
                        <ChevronRight className="size-3 shrink-0 transition-transform group-data-[state=open]/sub:rotate-90" />
                      </div>
                    </SidebarMenuSubButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-2 pb-1 pt-2">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                        <input
                          placeholder="Filter services…"
                          value={serviceFilter}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                            setServiceFilter(e.target.value)
                          }}
                          className="flex h-6 w-full rounded-md border border-input bg-background px-3 pl-6 text-[11px] ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      </div>
                    </div>
                    <SidebarMenuSub>
                      {filteredServices.map((svc: { id: string; name: string }) => (
                        <SidebarMenuSubItem key={svc.id}>
                          <SidebarMenuSubButton
                            asChild
                            isActive={pathname === `/dashboard/projects/${project.id}/services/${svc.id}`}
                          >
                            <Link href={`/dashboard/projects/${project.id}/services/${svc.id}`}>
                              {svc.name}
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuSubItem>
              </Collapsible>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

// ─── Main Sidebar ────────────────────────────────────────────────────────

/**
 * DashboardSidebar — the sidebar shell.
 * 
 * The inner content calls usePathname() (URL data). On routes with dynamic
 * params not covered by generateStaticParams, the pathname suspends during
 * prerendering. The Suspense boundary lives in the dashboard layout (server
 * tree) — it wraps this component so the static shell can commit and the
 * sidebar streams in behind its skeleton.
 */
export function DashboardSidebar() {
  return <DashboardSidebarInner />
}

function DashboardSidebarInner() {
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
        {/* Global search — opens the ⌘K palette */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <button
                  type="button"
                  onClick={() => { openCommandPalette(); }}
                  className="flex h-9 w-full items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-3 text-xs text-muted-foreground transition-colors hover:border-border/80 hover:bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 group-data-[collapsible=icon]:size-9 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
                  aria-label="Open command palette"
                >
                  <Search className="size-3.5 shrink-0" />
                  <span className="group-data-[collapsible=icon]:hidden">Search…</span>
                  <kbd className="ml-auto rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] group-data-[collapsible=icon]:hidden">
                    ⌘K
                  </kbd>
                </button>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

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
                        {navShortcuts[item.title] ? (
                          <kbd className="ml-auto hidden rounded border border-transparent px-1 font-mono text-[10px] text-muted-foreground/70 group-data-[collapsible=icon]:hidden lg:inline-block">
                            {navShortcuts[item.title]}
                          </kbd>
                        ) : null}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </Collapsible>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Mesh Section: Projects, Services — span all nodes */}
        <SidebarGroup>
          <SidebarGroupLabel>
            <Network className="size-3 mr-1" />
            Mesh
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {meshNavItems.map((item) => (
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

              {/* Inline Projects Section */}
              <ProjectsSidebarSection />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Node Section: Nodes, Deployments, Docker — per-node scope */}
        <SidebarGroup>
          <SidebarGroupLabel>
            <Server className="size-3 mr-1" />
            Nodes
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nodeNavItems.map((item) => (
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
                  <AuthDashboardProfile.Link className="cursor-pointer">
                    <UserCircle className="mr-2 size-4" />
                    Profile
                  </AuthDashboardProfile.Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void handleSignOut()} className="cursor-pointer text-destructive focus:text-destructive">
                  <LogOut className="mr-2 size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>

          {/* Theme toggle (W-F12): make the shipped dark mode reachable —
              the mode-toggle component was orphaned previously. */}
          <SidebarMenuItem>
            <ModeToggle />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
