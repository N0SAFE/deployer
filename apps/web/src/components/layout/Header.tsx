'use client'

import { SidebarTrigger } from '@repo/ui/components/shadcn/sidebar'
import { Separator } from '@repo/ui/components/shadcn/separator'
import { Wifi, WifiOff } from 'lucide-react'
import { useWebSocketConnection } from '@/hooks/useWebSocket'
import ThemeToggle from '@repo/ui/components/shadcn/mode-toggle'

export function Header() {
  const { isConnected, isConnecting } = useWebSocketConnection()

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
        {/* Theme Toggle */}
        <ThemeToggle />
      </div>
    </header>
  )
}