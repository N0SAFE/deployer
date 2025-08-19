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
} from '@repo/ui/components/shadcn/sidebar'
import {
  Home,
  FolderOpen,
  Zap,
  Globe,
  Settings,
  User,
  Rocket,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navigationItems = [
  {
    title: 'Dashboard',
    url: '/dashboard',
    icon: Home,
  },
  {
    title: 'Projects',
    url: '/projects',
    icon: FolderOpen,
  },
  {
    title: 'Deployments',
    url: '/deployments',
    icon: Zap,
  },
  {
    title: 'Traefik',
    url: '/traefik',
    icon: Globe,
  },
]

const settingsItems = [
  {
    title: 'Settings',
    url: '/settings',
    icon: Settings,
  },
  {
    title: 'User Settings',
    url: '/settings/user',
    icon: User,
  },
]

export function AppSidebar() {
  const pathname = usePathname()

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-border/40">
        <div className="flex items-center gap-2 px-4 py-2">
          <Rocket className="h-6 w-6 text-primary" />
          <span className="text-lg font-semibold">Deployer</span>
        </div>
      </SidebarHeader>
      
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigationItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.url || pathname.startsWith(`${item.url}/`)}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Account</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.url || pathname.startsWith(`${item.url}/`)}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-border/40">
        <div className="px-4 py-2 text-xs text-muted-foreground">
          Deployer v1.0.0
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}