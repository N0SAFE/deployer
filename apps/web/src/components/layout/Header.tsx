"use client"

import { Wifi, Dot } from "lucide-react"
import { SidebarSeparator, SidebarTrigger } from "@repo/ui/components/shadcn/sidebar"

import type { WebSocketStatus } from "../../hooks/useWebSocket"

const statusLabel: Record<WebSocketStatus, string> = {
  connected: "Live",
  connecting: "Connecting",
  error: "Error",
  idle: "Idle",
  mock: "Mock mode",
}

const statusColor: Record<WebSocketStatus, string> = {
  connected: "text-green-600",
  connecting: "text-amber-500",
  error: "text-red-600",
  idle: "text-muted-foreground",
  mock: "text-blue-600",
}

export function Header({ connectionStatus }: { connectionStatus: WebSocketStatus }) {
  return (
    <header className="flex h-14 items-center gap-3 border-b bg-card px-4">
      <SidebarTrigger className="h-8 w-8" />
      <SidebarSeparator className="mx-1 hidden md:block" />
      <div className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium">
        <Dot className={`h-4 w-4 ${statusColor[connectionStatus]}`} />
        <span className="text-muted-foreground">{statusLabel[connectionStatus]}</span>
      </div>
      <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        <Wifi className="h-4 w-4" />
        <span>Realtime pipeline</span>
      </div>
    </header>
  )
}
