'use client'

import { ChevronRight, Rocket, Search } from 'lucide-react'
import {
  visibleNavGroups,
  hasActiveNavChild,
  isNavItemActive,
  type NavGroup,
  type NavItem,
} from './navigation'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import ModeToggle from '@deployer/ui/components/shadcn/mode-toggle'
import { useEffect } from 'react'
import { AuthDashboard } from '@/routes'
import { useIsPlatformAdmin } from '@/lib/access/platform-role'
import { useSession } from '@/lib/auth'
import { SidebarProjectTree } from './SidebarProjectTree'
import { SidebarUserMenu } from './SidebarUserMenu'
import { toggleInList, useStoredStringList } from './persisted-state'
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
  useSidebar,
} from '@deployer/ui/components/shadcn/sidebar'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@deployer/ui/components/shadcn/collapsible'

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

// ─── Main Sidebar ────────────────────────────────────────────────────────

const COLLAPSED_GROUPS_KEY = 'deployer.sidebar.collapsedGroups'

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

/** True when the current route belongs to one of the group's entries. */
function groupHasActiveRoute(group: NavGroup, pathname: string): boolean {
  return group.items.some((item) => isNavItemActive(item, pathname) || hasActiveNavChild(item, pathname))
}

function DashboardSidebarInner() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const { state, isMobile, setOpenMobile } = useSidebar()
  const [collapsedGroups, setCollapsedGroups] = useStoredStringList(COLLAPSED_GROUPS_KEY)

  // The gate for the Admin Panel. The rule lives in `@/lib/access/platform-role`
  // rather than inline: the same `role === 'admin' || role === 'superAdmin'`
  // comparison was written out at five call sites.
  const isAdmin = useIsPlatformAdmin()
  const visibleGroups = visibleNavGroups(isAdmin)
  const iconRail = state === 'collapsed' && !isMobile

  // On phones the rail is an offcanvas sheet: close it once a page is chosen.
  useEffect(() => {
    if (isMobile) setOpenMobile(false)
  }, [pathname, isMobile, setOpenMobile])

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Deployer — Command center">
              <AuthDashboard.Link>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Rocket className="size-4" aria-hidden />
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold">Deployer</span>
                  <span className="text-xs text-muted-foreground">Self-hosted platform</span>
                </div>
              </AuthDashboard.Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <button
                  type="button"
                  onClick={() => {
                    openCommandPalette()
                  }}
                  title="Search pages, projects and services (⌘K / Ctrl+K)"
                  className="flex h-9 w-full items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-3 text-xs text-muted-foreground transition-colors hover:border-border/80 hover:bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 group-data-[collapsible=icon]:size-9 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
                  aria-label="Open command palette"
                >
                  <Search className="size-3.5 shrink-0" aria-hidden />
                  <span className="group-data-[collapsible=icon]:hidden">Search…</span>
                  <kbd className="ml-auto rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-xs group-data-[collapsible=icon]:hidden">
                    ⌘K
                  </kbd>
                </button>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/*
          One map over the shared navigation model; the rail and the ⌘K palette
          read the same list. Each group collapses (remembered per browser);
          the group holding the current route is always open, and the icon
          rail shows every entry so tooltips stay reachable.
        */}
        {visibleGroups.map((group) => {
          const active = groupHasActiveRoute(group, pathname)
          const open = iconRail || active || !collapsedGroups.includes(group.id)
          return (
            <Collapsible
              key={group.id}
              open={open}
              onOpenChange={() => {
                if (!active) setCollapsedGroups(toggleInList(collapsedGroups, group.id))
              }}
              className="group/nav"
            >
              <SidebarGroup>
                <SidebarGroupLabel asChild>
                  <CollapsibleTrigger
                    disabled={active}
                    title={active ? 'Holds the current page' : open ? `Collapse ${group.label}` : `Expand ${group.label}`}
                    className="flex w-full items-center gap-1 text-xs font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground"
                  >
                    <group.icon className="mr-1 size-3.5" aria-hidden />
                    {group.label}
                    <ChevronRight className="ml-auto size-3.5 transition-transform group-data-[state=open]/nav:rotate-90" aria-hidden />
                  </CollapsibleTrigger>
                </SidebarGroupLabel>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.items.map((item) => (
                        <NavEntry key={item.url} item={item} pathname={pathname} />
                      ))}
                      {group.hostsProjectTree ? <SidebarProjectTree /> : null}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          )
        })}
      </SidebarContent>

      <SidebarSeparator />

      <SidebarFooter>
        <SidebarUserMenu isAdmin={isAdmin} />
        <SidebarMenu>
          <SidebarMenuItem>
            <ModeToggle />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
