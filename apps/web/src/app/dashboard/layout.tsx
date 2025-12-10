"use client"

import { useEffect } from "react"
import { SidebarInset, SidebarProvider } from "@repo/ui/components/shadcn/sidebar"

import { AppSidebar } from "@/components/layout/AppSidebar"
import { Header } from "@/components/layout/Header"
import { useWebSocket } from "@/hooks/useWebSocket"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { status, connect } = useWebSocket()

  useEffect(() => {
    const cleanup = connect()
    return () => {
      if (cleanup) cleanup()
    }
  }, [connect])

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <SidebarInset className="flex min-h-screen flex-1 flex-col">
          <Header connectionStatus={status} />
          <main className="flex-1 px-4 py-6 md:px-8">
            {children}
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}
