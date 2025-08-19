'use client'

import { SidebarTrigger } from '@repo/ui/components/shadcn/sidebar'
import { Separator } from '@repo/ui/components/shadcn/separator'
import { Button } from '@repo/ui/components/shadcn/button'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Bell, Wifi, WifiOff } from 'lucide-react'
import { useWebSocketConnection } from '@/state/websocketStore'
import { useNotifications } from '@/state/uiStore'
import ThemeToggle from '@repo/ui/components/shadcn/mode-toggle'

export function Header() {
  const { isConnected, isConnecting } = useWebSocketConnection()
  const notifications = useNotifications()
  const unreadCount = notifications.filter(n => n.type === 'error' || n.type === 'warning').length

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      
      {/* Connection Status */}
      <div className="flex items-center gap-2">
        {isConnected ? (
          <div className="flex items-center gap-1 text-sm text-green-600">
            <Wifi className="h-4 w-4" />
            <span className="hidden sm:inline">Connected</span>
          </div>
        ) : isConnecting ? (
          <div className="flex items-center gap-1 text-sm text-yellow-600">
            <Wifi className="h-4 w-4 animate-pulse" />
            <span className="hidden sm:inline">Connecting...</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-sm text-red-600">
            <WifiOff className="h-4 w-4" />
            <span className="hidden sm:inline">Disconnected</span>
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Notifications */}
        <Button variant="ghost" size="sm" className="relative">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -right-1 -top-1 h-5 w-5 rounded-full p-0 text-xs"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
        </Button>

        {/* Theme Toggle */}
        <ThemeToggle />
      </div>
    </header>
  )
}