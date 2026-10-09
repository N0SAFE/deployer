'use client'

import { ChevronUp, LogOut, Shield, UserCircle } from 'lucide-react'
import { AuthDashboardSettingsAccount } from '@/routes'
import { useSession, signOut } from '@/lib/auth'
import { revalidateAllAction } from '@/components/signout/revalidateAll.action'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@repo/ui/components/shadcn/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@repo/ui/components/shadcn/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@repo/ui/components/shadcn/avatar'

export function getInitials(name: string | undefined): string {
  if (!name) return ''
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function Bone({ className }: { className: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-muted/60 motion-reduce:animate-none ${className}`} />
}

/** Placeholder for the user block until the session resolves — never a fake "User". */
function UserBlockSkeleton() {
  return (
    <SidebarMenuItem>
      <div role="status" aria-label="Loading account" className="flex h-12 items-center gap-2 px-2">
        <Bone className="size-8 shrink-0 rounded-lg" />
        <div className="grid flex-1 gap-1.5 group-data-[collapsible=icon]:hidden">
          <Bone className="h-3.5 w-24" />
          <Bone className="h-3 w-32" />
        </div>
      </div>
    </SidebarMenuItem>
  )
}

export function SidebarUserMenu({ isAdmin }: { isAdmin: boolean }) {
  const { data: session, isPending } = useSession()
  const user = session?.user

  const handleSignOut = async () => {
    await signOut()
    void revalidateAllAction()
    window.location.href = '/'
  }

  if (isPending || !user) {
    return (
      <SidebarMenu>
        <UserBlockSkeleton />
      </SidebarMenu>
    )
  }

  const avatar = (
    <Avatar className="h-8 w-8 rounded-lg">
      <AvatarImage src={user.image ?? undefined} alt="" />
      <AvatarFallback className="rounded-lg">{getInitials(user.name) || user.email.slice(0, 1).toUpperCase()}</AvatarFallback>
    </Avatar>
  )

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={user.name}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              {avatar}
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              </div>
              <ChevronUp className="ml-auto size-4" aria-hidden />
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
                {avatar}
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                </div>
                {isAdmin ? <Shield className="size-4 text-primary" aria-label="Administrator" /> : null}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <AuthDashboardSettingsAccount.Link className="cursor-pointer">
                <UserCircle className="mr-2 size-4" aria-hidden />
                Account settings
              </AuthDashboardSettingsAccount.Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => void handleSignOut()}
              className="cursor-pointer text-destructive focus:text-destructive"
            >
              <LogOut className="mr-2 size-4" aria-hidden />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
