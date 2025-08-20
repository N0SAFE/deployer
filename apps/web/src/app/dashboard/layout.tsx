'use client'

import { useEffect } from 'react'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useSidebarCollapsed } from '@/contexts/UIContext'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { SidebarProvider, SidebarInset } from '@repo/ui/components/shadcn/sidebar'
import { Header } from '@/components/layout/Header'
import { NotificationToasts } from '@/components/ui/NotificationToasts'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { connect } = useWebSocket()
  const sidebarCollapsed = useSidebarCollapsed()

  // Initialize WebSocket connection when entering dashboard
  useEffect(() => {
    connect()
    
    // Cleanup on unmount
    return () => {
      // Don't disconnect immediately as user might navigate within dashboard
      // WebSocket will handle reconnection if needed
    }
  }, []) // Remove connect from dependencies to avoid infinite loop

  return (
    <div className="min-h-screen bg-background">
      <SidebarProvider defaultOpen={!sidebarCollapsed}>
        <AppSidebar />
        <SidebarInset className="min-h-screen">
          <Header />
          <main className="flex flex-1 flex-col gap-4 p-4 pt-0">
            {children}
          </main>
        </SidebarInset>
        <NotificationToasts />
      </SidebarProvider>
    </div>
  )
}