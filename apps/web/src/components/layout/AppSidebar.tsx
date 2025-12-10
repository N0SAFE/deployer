"use client"

import type { ComponentType, PropsWithChildren } from "react"
import { usePathname } from "next/navigation"
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
  SidebarSeparator,
  useSidebar,
} from "@repo/ui/components/shadcn/sidebar"
import { Button } from "@repo/ui/components/shadcn/button"
import { Badge } from "@repo/ui/components/shadcn/badge"
import { Separator } from "@repo/ui/components/shadcn/separator"
import { LucideIcon, LayoutDashboard, Info, Shield, Rocket, Cloud, Activity } from "lucide-react"

import { Dashboard, Deployments, Projects, Health } from "@/routes"
import { UserProfileFooter } from "@/components/layout/UserProfileFooter"

interface NavRoute {
  (): string
  Link: ComponentType<PropsWithChildren<{ className?: string }>>
}

interface NavItem {
  title: string
  icon: LucideIcon
  Route: NavRoute
  badge?: string
}

const navItems: NavItem[] = [
  { title: "Overview", icon: LayoutDashboard, Route: Dashboard as NavRoute },
  { title: "Deployments", icon: Rocket, Route: Deployments as NavRoute },
  { title: "Projects", icon: Cloud, Route: Projects as NavRoute },
  { title: "Health", icon: Activity, Route: Health as NavRoute },
]

export function AppSidebar() {
  const pathname = usePathname()
  const sidebar = useSidebar()
  const isCollapsed = sidebar.state === "collapsed"

  return (
    <Sidebar className="border-r bg-sidebar">
      <SidebarHeader className="border-b px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Shield className="h-4 w-4 text-primary" />
            <span className="truncate">Deployer Dashboard</span>
          </div>
          <Badge variant="secondary" className="text-[10px] uppercase">beta</Badge>
        </div>
        <Separator className="mt-3" />
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const href = item.Route()
                const isActive = pathname === href
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <item.Route.Link className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        <span className="truncate">{item.title}</span>
                        {item.badge ? (
                          <Badge variant="secondary" className="ml-auto text-[10px] uppercase">
                            {item.badge}
                          </Badge>
                        ) : null}
                      </item.Route.Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator className="my-4" />

        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            Resources
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Health.Link className="flex items-center gap-2">
                    <Info className="h-4 w-4" />
                    <span className="truncate">Status & Health</span>
                  </Health.Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="mt-auto border-t p-3">
        <UserProfileFooter isCollapsed={isCollapsed} />
        {!isCollapsed ? (
          <Button variant="secondary" size="sm" className="mt-3 w-full" asChild>
            <Deployments.Link>View deployments</Deployments.Link>
          </Button>
        ) : null}
      </SidebarFooter>
    </Sidebar>
  )
}
