'use client'

import {
  ChevronRight,
  ChevronUp,
  FolderKanban,
  Home,
  LogOut,
  Search,
  Shield,
  UserCircle,
} from 'lucide-react'
import {
  NAV_GROUPS,
  hasActiveNavChild,
  isNavItemActive,
  type NavItem,
} from './navigation'
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

/**
 * One rail entry, rendered from the shared navigation model.
 *
 * Entries carrying `items` get a real nested submenu. Before this, only the
 * Node engine group honoured `items` and the Admin group ignored the field
 * entirely, so the eight provider sub-entries were rendered nowhere at all -
 * the data existed and no surface ever drew it.
 */
function NavEntry({ item, pathname }: { item: NavItem; pathname: string }) {
  const isActive = isNavItemActive(item, pathname)
  const hasChildren = (item.items?.length ?? 0) > 0

  const entry = (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
        <Link href={item.url}>
          <item.icon />
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
      {hasChildren ? (
        <>
          <CollapsibleTrigger asChild>
            <SidebarMenuAction className="group-data-[state=open]/collapsible:rotate-90">
              <ChevronRight />
              <span className="sr-only">{`Toggle ${item.title}`}</span>
            </SidebarMenuAction>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub>
              {item.items?.map((subItem) => (
                <SidebarMenuSubItem key={subItem.url}>
                  <SidebarMenuSubButton asChild isActive={isNavItemActive(subItem, pathname)}>
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
  )

  if (!hasChildren) return entry

  return (
    <Collapsible
      asChild
      defaultOpen={isActive || hasActiveNavChild(item, pathname)}
      className="group/collapsible"
    >
      {entry}
    </Collapsible>
  )
}

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

  const visibleGroups = NAV_GROUPS.filter((group) => group.adminOnly !== true || isAdmin)

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

        {/*
          One map over the shared navigation model. The rail and the ⌘K palette
          read the same list, so the same page can no longer be called two
          different things depending on which surface you searched in.
        */}
        {visibleGroups.map((group) => (
          <SidebarGroup key={group.id}>
            <SidebarGroupLabel>
              <group.icon className="size-3 mr-1" />
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <NavEntry key={item.url} item={item} pathname={pathname} />
                ))}
                {group.hostsProjectTree ? <ProjectsSidebarSection /> : null}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
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
