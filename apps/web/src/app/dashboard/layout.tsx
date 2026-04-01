import { DashboardSidebar, DashboardLoadingSkeleton } from '@/components/dashboard'
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@repo/ui/components/shadcn/sidebar'
import { Separator } from '@repo/ui/components/shadcn/separator'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { DashboardBreadcrumbs } from '@/components/dashboard/DashboardBreadcrumbs'
import { createSessionLayout } from '@repo/declarative-routing/layout-wrappers/server'
import { SessionHydrationProvider } from '@/utils/providers/SessionHydrationProvider'
import { QueryErrorBoundary } from '@/components/error'
// Import to trigger server-side auth configuration (including layout auth)
import '@/routes/configure-auth'

/**
 * Dashboard Layout with Session Hydration and Error Boundaries
 * 
 * Uses createSessionLayout to:
 * 1. Fetch session on the server
 * 2. Hydrate React Query cache with session data
 * 3. Make session available to ALL child components via useSession()
 * 
 * NOTE: No Suspense wrapper around SessionHydrationProvider!
 * createSessionLayout already has an internal Suspense boundary.
 * Adding another Suspense causes a loading flash ("big displacement").
 * By not wrapping in Suspense, the server waits for session data before
 * streaming the entire layout, eliminating any visual flash.
 * 
 * QueryErrorBoundary wraps the main content to catch and handle data
 * fetching errors gracefully, providing retry functionality.
 */
export default createSessionLayout(({ children }) => {
  // session is available via createSessionLayout but we don't need to access it
  // because it's hydrated to React Query - child components use useSession()
  return (
    <SessionHydrationProvider>
      <SidebarProvider>
        <DashboardSidebar />
        <SidebarInset className="bg-linear-to-b from-primary/[0.035] via-background to-background">
          {/* Header with trigger and breadcrumbs */}
          <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background/85 px-4 backdrop-blur-xl">
            <div className="flex min-w-0 items-center gap-2">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-1 h-4" />
              <DashboardBreadcrumbs />
            </div>
            <div className="hidden items-center gap-2 md:flex">
              <Badge variant="secondary" className="border border-border/70">
                Projects + Deployments
              </Badge>
            </div>
          </header>
          
          {/* Main content with error boundary */}
          <main className="flex-1 overflow-y-auto">
            <QueryErrorBoundary context="Dashboard">
              <div className="mx-auto w-full max-w-screen-2xl px-4 py-7 xl:px-6">
                {children}
              </div>
            </QueryErrorBoundary>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </SessionHydrationProvider>
  )
}, {
  // Beautiful loading skeleton shown during initial session fetch
  fallback: <DashboardLoadingSkeleton />,
})
