'use client'

import { useEffect } from 'react'
import { useWebSocketStore } from '@/state/websocketStore'
import { useUIStore } from '@/state/uiStore'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { SidebarProvider, SidebarInset } from '@repo/ui/components/shadcn/sidebar'
import { Header } from '@/components/layout/Header'
import { NotificationToasts } from '@/components/ui/NotificationToasts'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const connect = useWebSocketStore((state) => state.connect)
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed)

  // Initialize WebSocket connection when entering dashboard
  useEffect(() => {
    connect()
    
    // Cleanup on unmount
    return () => {
      // Don't disconnect immediately as user might navigate within dashboard
      // WebSocket will handle reconnection if needed
    }
  }, [connect])

  return (
    <SidebarProvider defaultOpen={!sidebarCollapsed}>
      <AppSidebar />
      <SidebarInset>
        <Header />
        <main className="flex flex-1 flex-col gap-4 p-4 pt-0">
          {children}
        </main>
      </SidebarInset>
      <NotificationToasts />
    </SidebarProvider>
  )
}